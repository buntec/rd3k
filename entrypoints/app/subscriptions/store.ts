import { useSyncExternalStore } from 'react';
import {
  type NewPost,
  NotLoggedInError,
  type Subreddit,
  fetchNewPosts,
  fetchSubscriptions,
  onRateLimitWait,
  subscribe as setSubscribed,
} from '@/utils/reddit';
import { accountName, confirmAccount, keyOf, loadConfirmedAccount, onAccountChange } from '../account';
import { keyFor, untilMoved } from '../accountStorage';

export interface Feed {
  fetchedAt: number;
  /** Newest first */
  posts: NewPost[];
}

/** By subreddit, lowercased: Reddit's names ignore case. */
export type Feeds = Partial<Record<string, Feed>>;

export interface SubscriptionsState {
  subreddits: Subreddit[];
  feeds: Feeds;
  status: { text: string; isError: boolean };
  isRefreshing: boolean;
}

/** Subreddits' names as stored and looked up: Reddit's ignore case. */
export const key = (name: string) => name.toLowerCase();

const FEED_MAX_AGE = 15 * 60 * 1000;
// Feeds loaded so far are stored at most this often during a refresh, each
// time once Reddit confirms the account, so closing the page keeps most.
const CHECKPOINT_INTERVAL = 30 * 1000;
// Each subreddit is one page request, which Reddit allows about 600 of per
// 10 minutes. A few at a time stays well clear of tripping anything else.
const CONCURRENT_REQUESTS = 4;

// Each account's subscriptions and their newest posts are stored apart, so
// switching accounts on reddit.com switches them too.
interface Session {
  /** As accountKey() makes it, or null when logged out */
  account: string | null;
  items?: {
    subscriptions: WxtStorageItem<Subreddit[], {}>;
    feeds: WxtStorageItem<Feeds, {}>;
  };
  /**
   * Unsubscribed from since the page opened. A refresh under way, or Reddit's
   * list of subscriptions before it catches up, would otherwise bring them back.
   */
  unsubscribed: Set<string>;
  reloading?: Promise<void>;
  /** Gives up on the session's requests, including those waiting for the rate limit, on switching accounts */
  abort: AbortController;
}

const EMPTY: SubscriptionsState = {
  subreddits: [],
  feeds: {},
  status: { text: '', isError: false },
  isRefreshing: false,
};
const LOGGED_OUT_STATUS = 'Log in to Reddit in this browser to see your subscriptions.';

// Lives outside React so switching pages keeps the data and doesn't refetch
// it; the first page that uses it loads it.
let state: SubscriptionsState = EMPTY;
let session: Session | undefined;
const listeners = new Set<() => void>();
let cached: Promise<void> | undefined;

/** Without the feeds of subreddits unsubscribed from meanwhile */
function withoutUnsubscribed(s: Session, feeds: Feeds): Feeds {
  return Object.fromEntries(Object.entries(feeds).filter(([name]) => !s.unsubscribed.has(name)));
}

export function useSubscriptions(): SubscriptionsState {
  void loadSubscriptions();
  return useSyncExternalStore(subscribe, () => state);
}

/** The subscriptions and feeds stored earlier, once loaded; also starts bringing them up to date. */
export async function loadSubscriptions(): Promise<SubscriptionsState> {
  cached ??= load();
  await cached;
  return state;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Changes the state shown, unless `s` is an account's switched away from. */
function update(s: Session, patch: Partial<SubscriptionsState>) {
  if (s !== session) return;
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setStatus(s: Session, text: string, isError = false) {
  update(s, { status: { text, isError } });
}

async function load() {
  onAccountChange((name) => void open(name));
  // Show what's stored for the account last seen right away; refreshing waits
  // until Reddit confirms it.
  let name = accountName();
  if (name === undefined) {
    try {
      name = (await loadConfirmedAccount())?.name ?? null;
    } catch (err) {
      // Not known to be logged out: Reddit's first answer opens the session.
      if (!session) {
        state = { ...state, status: { text: `Couldn't reach Reddit: ${errorText(err)}`, isError: true } };
        for (const listener of listeners) listener();
      }
      return;
    }
  }
  // Unless Reddit reported an account meanwhile
  if (!session) await open(name);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shows the subscriptions stored for the account, then brings them up to date. */
async function open(name: string | null) {
  const account = keyOf(name);
  if (session && session.account === account) return;
  session?.abort.abort();
  const s: Session = { account, unsubscribed: new Set(), abort: new AbortController() };
  session = s;
  update(s, EMPTY);
  if (!account) {
    setStatus(s, LOGGED_OUT_STATUS, true);
    return;
  }
  // Not before data from earlier versions moved here, which a change stored
  // now would have it skip
  const isMoved = await untilMoved(
    () => s === session,
    () => setStatus(s, "Couldn't load what's stored for this account. Trying again on coming back to the tab.", true),
  );
  if (!isMoved) return;
  const items = {
    subscriptions: storage.defineItem<Subreddit[]>(keyFor('local:subscriptions', account), { fallback: [] }),
    feeds: storage.defineItem<Feeds>(keyFor('local:feeds', account), { fallback: {}, version: 1 }),
  };
  const [subreddits, feeds] = await Promise.all([items.subscriptions.getValue(), items.feeds.getValue()]);
  if (s !== session) return;
  s.items = items;
  update(s, { subreddits, feeds });
  void reload(s, { subscriptions: true, force: false });
}

/**
 * Whether the browser is still logged in as the session's account, asking
 * Reddit now: what Reddit sends is the account it's logged in as, which
 * may have changed on reddit.com since the session started. Throws if Reddit
 * couldn't be asked.
 */
async function isCurrent(s: Session): Promise<boolean> {
  const confirmed = await confirmAccount();
  return s === session && keyOf(confirmed?.name) === s.account;
}

/**
 * Loads the subscriptions again, then their newest posts: all of them if
 * forced, else only those that got old.
 */
export function refresh(force: boolean) {
  return session && reload(session, { subscriptions: true, force });
}

/** Loads the feeds that got old again, keeping the list of subscriptions. */
export function refreshStaleFeeds() {
  return session && reload(session, { subscriptions: false, force: false });
}

/** Joins a refresh under way rather than starting another. */
function reload(s: Session, options: { subscriptions: boolean; force: boolean }) {
  s.reloading ??= reloadNow(s, options).finally(() => {
    s.reloading = undefined;
  });
  return s.reloading;
}

async function reloadNow(s: Session, options: { subscriptions: boolean; force: boolean }) {
  const items = s.items;
  if (s !== session || !items) return;
  // Leave the page alone when there's nothing to do, as on most timed updates.
  if (!options.subscriptions && staleSubreddits(false).length === 0) return;
  const { signal } = s.abort;
  // Put back if the refresh gives up without a word, e.g. on a switch
  const statusBefore = state.status;
  let isFinished = false;
  update(s, { isRefreshing: true });
  // Mutated as feeds arrive and published in batches by scheduleUpdate().
  let feeds = state.feeds;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let progress = '';
  let checkpointAt = Date.now();

  /** Re-render at most every half second while loading, and now and then store what's loaded. */
  const scheduleUpdate = () => {
    updateTimer ??= setTimeout(() => {
      updateTimer = undefined;
      if (s !== session) return;
      feeds = withoutUnsubscribed(s, feeds);
      update(s, { feeds: { ...feeds } });
      if (Date.now() - checkpointAt >= CHECKPOINT_INTERVAL) {
        checkpointAt = Date.now();
        void checkpoint({ ...feeds });
      }
    }, 500);
  };

  /** Stores the feeds loaded so far, once Reddit confirms they're the account's. */
  const checkpoint = async (loaded: Feeds) => {
    try {
      if (!signal.aborted && (await isCurrent(s))) await items.feeds.setValue(loaded);
    } catch (err) {
      console.warn(err);
    }
  };

  // Reddit's rate limit pauses requests until it resets; say so rather than
  // seem stuck.
  const stopWatching = onRateLimitWait((_bucket, resetAt) => {
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
    setStatus(s, `${progress} Waiting for Reddit's rate limit, about ${minutes} min…`);
  });

  try {
    // Reddit may be logged in as another account than the one shown, as on
    // opening with the data of the account last seen. Asking it also reports
    // a switch, which opens the other account's session.
    if (!(await isCurrent(s))) return;

    if (options.subscriptions) {
      setStatus(s, 'Loading subscriptions…');
      try {
        const fetched = await fetchSubscriptions(signal);
        // Switched meanwhile, they may be the other account's.
        if (!(await isCurrent(s))) return;
        const subreddits = fetched.filter((sub) => !s.unsubscribed.has(key(sub.name)));
        await items.subscriptions.setValue(subreddits);
        const names = new Set(subreddits.map((sub) => key(sub.name)));
        feeds = Object.fromEntries(Object.entries(feeds).filter(([name]) => names.has(name)));
        update(s, { subreddits, feeds });
      } catch (err) {
        if (signal.aborted) return;
        // Without a fresh list, keep going with the cached one if there is one.
        if (state.subreddits.length === 0 || err instanceof NotLoggedInError) throw err;
        console.warn(err);
      }
    }

    feeds = { ...feeds };
    const stale = staleSubreddits(options.force);
    let done = 0;
    let failed = 0;
    await forEachConcurrently(stale, CONCURRENT_REQUESTS, async (subreddit) => {
      // Stop on switching accounts, which has subreddits of its own.
      if (signal.aborted) return;
      try {
        const posts = await fetchNewPosts(subreddit.name, { signal });
        feeds[key(subreddit.name)] = { fetchedAt: Date.now(), posts };
      } catch (err) {
        if (signal.aborted) return;
        failed++;
        console.warn(subreddit.name, err);
      }
      progress = `Updating ${++done} of ${stale.length}…`;
      setStatus(s, progress);
      scheduleUpdate();
    });

    clearTimeout(updateTimer);
    if (signal.aborted || !(await isCurrent(s))) return;
    feeds = withoutUnsubscribed(s, feeds);
    await items.feeds.setValue(feeds);
    update(s, { feeds });
    setStatus(
      s,
      `${state.subreddits.length} subreddits` + (failed ? ` · ${failed} failed to load` : ''),
      failed > 0 && failed === stale.length,
    );
    isFinished = true;
  } catch (err) {
    setStatus(s, err instanceof NotLoggedInError ? LOGGED_OUT_STATUS : errorText(err), true);
    isFinished = true;
  } finally {
    clearTimeout(updateTimer);
    stopWatching();
    update(s, isFinished ? { isRefreshing: false } : { isRefreshing: false, status: statusBefore });
  }
}

function staleSubreddits(force: boolean) {
  return state.subreddits.filter(
    (s) => force || Date.now() - (state.feeds[key(s.name)]?.fetchedAt ?? 0) > FEED_MAX_AGE,
  );
}

/** Whether the user is subscribed to the subreddit, as far as the stored list knows */
export function isSubscribed(name: string): boolean {
  return state.subreddits.some((s) => key(s.name) === key(name));
}

/**
 * Subscribes or unsubscribes, then loads the list again, so a new
 * subscription shows up with its posts. Throws if Reddit refuses.
 */
export async function setSubscription(name: string, isSubscribedNow: boolean) {
  void loadSubscriptions();
  const s = session;
  // Not waiting for it, which may take until Reddit can be reached
  if (!s) throw new Error('Still finding out which Reddit account this is. Try again in a moment.');
  if (!s.account) throw new NotLoggedInError();
  // Reddit (un)subscribes whichever account it's logged in as, which may
  // have changed on reddit.com since the page last looked.
  if (!(await isCurrent(s))) {
    throw new Error("The Reddit account changed since this page last looked, so nothing changed. Try again.");
  }
  await setSubscribed(name, isSubscribedNow);
  // Switched accounts meanwhile: the new one's list is loaded anew anyway.
  if (s !== session) return;
  // Kept even while the stored list is still opening, which reloads it then
  if (isSubscribedNow) s.unsubscribed.delete(key(name));
  else s.unsubscribed.add(key(name));
  const { items } = s;
  if (!items) return;
  if (isSubscribedNow) {
    void reload(s, { subscriptions: true, force: false });
    return;
  }
  const subreddits = state.subreddits.filter((sub) => key(sub.name) !== key(name));
  const { [key(name)]: _, ...feeds } = state.feeds;
  update(s, { subreddits, feeds });
  setStatus(s, `Unsubscribed from r/${name}`);
  // Stored once Reddit confirms the account it unsubscribed; else the next
  // refresh brings the stored list up to date.
  if (await isCurrent(s).catch(() => false)) {
    await Promise.all([items.subscriptions.setValue(subreddits), items.feeds.setValue(feeds)]);
  }
}

async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

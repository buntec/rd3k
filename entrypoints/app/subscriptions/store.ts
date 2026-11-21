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
import { accountKey, accountName, loadAccount, onAccountChange } from '../account';
import { adoptUnkeyed, keyFor } from '../accountStorage';

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
  if (name === undefined) name = (await loadAccount())?.name ?? null;
  // Unless Reddit reported an account meanwhile
  if (!session) await open(name);
}

/** Shows the subscriptions stored for the account, then brings them up to date. */
async function open(name: string | null) {
  const account = name && accountKey(name);
  if (session && session.account === account) return;
  const s: Session = { account, unsubscribed: new Set() };
  session = s;
  update(s, EMPTY);
  if (!account) {
    setStatus(s, LOGGED_OUT_STATUS, true);
    return;
  }
  await Promise.all([adoptUnkeyed('local:subscriptions', account), adoptUnkeyed('local:feeds', account)]);
  s.items = {
    subscriptions: storage.defineItem<Subreddit[]>(keyFor('local:subscriptions', account), { fallback: [] }),
    feeds: storage.defineItem<Feeds>(keyFor('local:feeds', account), { fallback: {}, version: 1 }),
  };
  const [subreddits, feeds] = await Promise.all([s.items.subscriptions.getValue(), s.items.feeds.getValue()]);
  update(s, { subreddits, feeds });
  void reload(s, { subscriptions: true, force: false });
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
  // Before Reddit confirms the account, the stored data may be another's.
  await loadAccount();
  if (s !== session || !s.items) return;
  const items = s.items;
  // Leave the page alone when there's nothing to do, as on most timed updates.
  if (!options.subscriptions && staleSubreddits(false).length === 0) return;
  update(s, { isRefreshing: true });
  // Mutated as feeds arrive and published in batches by scheduleUpdate().
  let feeds = state.feeds;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let progress = '';

  /** Re-render and persist progress at most every half second while loading. */
  const scheduleUpdate = () => {
    updateTimer ??= setTimeout(() => {
      updateTimer = undefined;
      feeds = withoutUnsubscribed(s, feeds);
      update(s, { feeds: { ...feeds } });
      void items.feeds.setValue(feeds);
    }, 500);
  };

  // Reddit's rate limit pauses requests until it resets; say so rather than
  // seem stuck.
  const stopWatching = onRateLimitWait((_bucket, resetAt) => {
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
    setStatus(s, `${progress} Waiting for Reddit's rate limit, about ${minutes} min…`);
  });

  try {
    if (options.subscriptions) {
      setStatus(s, 'Loading subscriptions…');
      try {
        const subreddits = (await fetchSubscriptions()).filter((sub) => !s.unsubscribed.has(key(sub.name)));
        // Switched accounts meanwhile: these may be either's.
        if (s !== session) return;
        await items.subscriptions.setValue(subreddits);
        const names = new Set(subreddits.map((sub) => key(sub.name)));
        feeds = Object.fromEntries(Object.entries(feeds).filter(([name]) => names.has(name)));
        update(s, { subreddits, feeds });
      } catch (err) {
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
      if (s !== session) return;
      try {
        const posts = await fetchNewPosts(subreddit.name);
        feeds[key(subreddit.name)] = { fetchedAt: Date.now(), posts };
      } catch (err) {
        failed++;
        console.warn(subreddit.name, err);
      }
      progress = `Updating ${++done} of ${stale.length}…`;
      setStatus(s, progress);
      scheduleUpdate();
    });

    clearTimeout(updateTimer);
    feeds = withoutUnsubscribed(s, feeds);
    await items.feeds.setValue(feeds);
    update(s, { feeds });
    setStatus(
      s,
      `${state.subreddits.length} subreddits` + (failed ? ` · ${failed} failed to load` : ''),
      failed > 0 && failed === stale.length,
    );
  } catch (err) {
    clearTimeout(updateTimer);
    setStatus(
      s,
      err instanceof NotLoggedInError ? LOGGED_OUT_STATUS : err instanceof Error ? err.message : String(err),
      true,
    );
  } finally {
    stopWatching();
    update(s, { isRefreshing: false });
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
  const s = session;
  await setSubscribed(name, isSubscribedNow);
  if (!s?.items || s !== session) return;
  if (!isSubscribedNow) {
    s.unsubscribed.add(key(name));
    const subreddits = state.subreddits.filter((sub) => key(sub.name) !== key(name));
    const { [key(name)]: _, ...feeds } = state.feeds;
    await Promise.all([s.items.subscriptions.setValue(subreddits), s.items.feeds.setValue(feeds)]);
    update(s, { subreddits, feeds });
    setStatus(s, `Unsubscribed from r/${name}`);
    return;
  }
  s.unsubscribed.delete(key(name));
  void reload(s, { subscriptions: true, force: false });
}

async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

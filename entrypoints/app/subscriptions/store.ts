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

const subscriptionsItem = storage.defineItem<Subreddit[]>('local:subscriptions', { fallback: [] });
const feedsItem = storage.defineItem<Feeds>('local:feeds', { fallback: {}, version: 1 });

// Lives outside React so switching pages keeps the data and doesn't refetch
// it; the first page that uses it loads it.
let state: SubscriptionsState = {
  subreddits: [],
  feeds: {},
  status: { text: '', isError: false },
  isRefreshing: false,
};
const listeners = new Set<() => void>();
let cached: Promise<void> | undefined;
let reloading: Promise<void> | undefined;

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

function update(patch: Partial<SubscriptionsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setStatus(text: string, isError = false) {
  update({ status: { text, isError } });
}

async function load() {
  // Show cached data right away, then bring it up to date.
  const [subreddits, feeds] = await Promise.all([subscriptionsItem.getValue(), feedsItem.getValue()]);
  update({ subreddits, feeds });
  void refresh(false);
}

/**
 * Loads the subscriptions again, then their newest posts: all of them if
 * forced, else only those that got old.
 */
export function refresh(force: boolean) {
  return reload({ subscriptions: true, force });
}

/** Loads the feeds that got old again, keeping the list of subscriptions. */
export function refreshStaleFeeds() {
  return reload({ subscriptions: false, force: false });
}

/** Joins a refresh under way rather than starting another. */
function reload(options: { subscriptions: boolean; force: boolean }) {
  reloading ??= reloadNow(options).finally(() => {
    reloading = undefined;
  });
  return reloading;
}

async function reloadNow(options: { subscriptions: boolean; force: boolean }) {
  // Leave the page alone when there's nothing to do, as on most timed updates.
  if (!options.subscriptions && staleSubreddits(false).length === 0) return;
  update({ isRefreshing: true });
  // Mutated as feeds arrive and published in batches by scheduleUpdate().
  let feeds = state.feeds;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let progress = '';

  /** Re-render and persist progress at most every half second while loading. */
  const scheduleUpdate = () => {
    updateTimer ??= setTimeout(() => {
      updateTimer = undefined;
      update({ feeds: { ...feeds } });
      void feedsItem.setValue(feeds);
    }, 500);
  };

  // Reddit's rate limit pauses requests until it resets; say so rather than
  // seem stuck.
  const stopWatching = onRateLimitWait((_bucket, resetAt) => {
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
    setStatus(`${progress} Waiting for Reddit's rate limit, about ${minutes} min…`);
  });

  try {
    if (options.subscriptions) {
      setStatus('Loading subscriptions…');
      try {
        const subreddits = await fetchSubscriptions();
        await subscriptionsItem.setValue(subreddits);
        const names = new Set(subreddits.map((s) => key(s.name)));
        feeds = Object.fromEntries(Object.entries(feeds).filter(([name]) => names.has(name)));
        update({ subreddits, feeds });
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
      try {
        const posts = await fetchNewPosts(subreddit.name);
        feeds[key(subreddit.name)] = { fetchedAt: Date.now(), posts };
      } catch (err) {
        failed++;
        console.warn(subreddit.name, err);
      }
      progress = `Updating ${++done} of ${stale.length}…`;
      setStatus(progress);
      scheduleUpdate();
    });

    clearTimeout(updateTimer);
    await feedsItem.setValue(feeds);
    update({ feeds });
    setStatus(
      `${state.subreddits.length} subreddits` + (failed ? ` · ${failed} failed to load` : ''),
      failed > 0 && failed === stale.length,
    );
  } catch (err) {
    clearTimeout(updateTimer);
    setStatus(
      err instanceof NotLoggedInError
        ? 'Log in to Reddit in this browser to see your subscriptions.'
        : err instanceof Error
          ? err.message
          : String(err),
      true,
    );
  } finally {
    stopWatching();
    update({ isRefreshing: false });
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
  await setSubscribed(name, isSubscribedNow);
  if (!isSubscribedNow) {
    const subreddits = state.subreddits.filter((s) => key(s.name) !== key(name));
    const { [key(name)]: _, ...feeds } = state.feeds;
    await Promise.all([subscriptionsItem.setValue(subreddits), feedsItem.setValue(feeds)]);
    update({ subreddits, feeds });
    setStatus(`Unsubscribed from r/${name}`);
    return;
  }
  void refresh(false);
}

async function forEachConcurrently<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

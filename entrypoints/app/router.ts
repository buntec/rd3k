import { useSyncExternalStore } from 'react';

// Hash routes (app.html#/feed): extension pages have no server to fall back
// to index.html, so a reload on a path route would not find the page.

/** The pages in the top bar, by route */
export const PAGES = {
  subs: 'Subs',
  feed: 'Feed',
  popular: 'Popular',
  saved: 'Saved',
} as const;

export type PageRoute = keyof typeof PAGES;

export type Route =
  | { page: PageRoute }
  | { page: 'subreddit'; name: string }
  | { page: 'thread'; postId: string; commentId?: string };

const DEFAULT: Route = { page: 'subs' };

export function routeHref(route: Route): string {
  switch (route.page) {
    case 'subreddit':
      return `#/r/${route.name}`;
    case 'thread':
      return `#/comments/${route.postId}${route.commentId ? `/${route.commentId}` : ''}`;
    default:
      return `#/${route.page}`;
  }
}

export const subredditHref = (name: string) => routeHref({ page: 'subreddit', name });
export const threadHref = (postId: string, commentId?: string) =>
  routeHref({ page: 'thread', postId, commentId });

/**
 * Where the app is: the route, and the page to show it over. A thread opens
 * in a dialog over the page it was opened from, which stays as it was.
 */
export interface AppLocation {
  route: Route;
  /** The route itself, or for a thread, the page behind it */
  page: Route;
}

export function useAppLocation(): AppLocation {
  return useSyncExternalStore(subscribe, getAppLocation);
}

export const getAppLocation = (): AppLocation => getSnapshot();

// A thread's history entry remembers the page it was opened from, and how
// many thread entries lead back to it, so closing a thread reached through
// links in others returns there in one step. The record lives in
// history.state, so it holds across back, forward and reloads.

const STATE_KEY = 'rd3kThread';

interface ThreadEntry {
  /** Entries back to the page behind, counting this one */
  depth: number;
  /** That page's hash; none if the app opened on a thread */
  behind?: string;
}

interface Snapshot extends AppLocation {
  hash: string;
  thread?: ThreadEntry;
}

let snapshot: Snapshot | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): Snapshot {
  if (!snapshot) {
    snapshot = locate(undefined);
    window.addEventListener('hashchange', () => {
      snapshot = locate(snapshot);
      for (const listener of listeners) listener();
    });
  }
  return snapshot;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The current location, reached from `previous` */
function locate(previous: Snapshot | undefined): Snapshot {
  const hash = location.hash;
  const route = parseRoute(hash);
  if (route.page !== 'thread') return { hash, route, page: route };
  let thread = threadEntryOf(history.state);
  if (!thread) {
    // A new entry, as back and forward return to ones with a record.
    thread =
      previous?.thread ? { depth: previous.thread.depth + 1, behind: previous.thread.behind }
      : previous ? { depth: 1, behind: previous.hash }
      : { depth: 1 };
    history.replaceState({ ...(isRecord(history.state) ? history.state : {}), [STATE_KEY]: thread }, '');
  }
  return { hash, route, page: parseRoute(thread.behind ?? ''), thread };
}

function threadEntryOf(state: unknown): ThreadEntry | undefined {
  const entry = isRecord(state) ? state[STATE_KEY] : undefined;
  return isRecord(entry) && typeof entry.depth === 'number' ? (entry as unknown as ThreadEntry) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Back to the page the open thread was opened from */
export function closeThread() {
  const thread = getSnapshot().thread;
  if (!thread) return;
  if (thread.behind !== undefined) history.go(-thread.depth);
  else location.replace(routeHref(DEFAULT));
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (first === 'r' && second && /^\w+$/.test(second)) return { page: 'subreddit', name: second };
  if (first === 'comments' && second && /^\w+$/.test(second)) {
    return { page: 'thread', postId: second, commentId: third && /^\w+$/.test(third) ? third : undefined };
  }
  if (first && Object.hasOwn(PAGES, first)) return { page: first as PageRoute };
  return DEFAULT;
}

/**
 * The in-app route for a link to Reddit, e.g. in a comment, if rd3k shows
 * what it links to: a subreddit or a thread.
 */
export function routeForRedditUrl(href: string): Route | undefined {
  let url: URL;
  try {
    url = new URL(href, 'https://www.reddit.com');
  } catch {
    return undefined;
  }
  if (!/^(www\.|old\.|new\.|np\.)?reddit\.com$/.test(url.hostname) && url.hostname !== 'redd.it') {
    return undefined;
  }
  if (url.hostname === 'redd.it') {
    const id = url.pathname.slice(1);
    return /^\w+$/.test(id) ? { page: 'thread', postId: id } : undefined;
  }
  const thread = url.pathname.match(/^\/r\/\w+\/comments\/(\w+)(?:\/[^/]*\/(\w+))?/);
  if (thread) return { page: 'thread', postId: thread[1]!, commentId: thread[2] };
  const sub = url.pathname.match(/^\/r\/(\w+)\/?$/);
  if (sub) return sub[1]!.toLowerCase() === 'popular' ? { page: 'popular' } : { page: 'subreddit', name: sub[1]! };
  return undefined;
}

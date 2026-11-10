import { useMemo, useSyncExternalStore } from 'react';

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

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
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

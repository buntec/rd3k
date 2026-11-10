import { useSyncExternalStore } from 'react';

/**
 * The choices for how many of each subreddit's newest posts are shown: up
 * to the few that its "new" page holds before it loads more on scroll.
 */
export const POSTS_PER_SUB_CHOICES = [1, 2, 3] as const;

export type PostsPerSub = (typeof POSTS_PER_SUB_CHOICES)[number];

const DEFAULT: PostsPerSub = 3;

// localStorage, so the page has it on first render.
const STORAGE_KEY = 'postsPerSub';

const listeners = new Set<() => void>();

/** The stored number of posts shown per subreddit, kept in sync with other tabs. */
export function usePostsPerSub(): PostsPerSub {
  return useSyncExternalStore(subscribe, stored);
}

export function setPostsPerSub(count: PostsPerSub) {
  try {
    if (count === DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(count));
  } catch (err) {
    console.warn(err);
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  // Follow changes made on the page in other tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function stored(): PostsPerSub {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (POSTS_PER_SUB_CHOICES.includes(value as PostsPerSub)) return value as PostsPerSub;
  } catch {}
  return DEFAULT;
}

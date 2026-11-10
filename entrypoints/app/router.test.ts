import { describe, expect, it } from 'vitest';
import { parseRoute, routeForRedditUrl, routeHref } from './router';

describe('parseRoute', () => {
  it('reads each kind of route', () => {
    expect(parseRoute('#/feed')).toEqual({ page: 'feed' });
    expect(parseRoute('#/r/AskReddit')).toEqual({ page: 'subreddit', name: 'AskReddit' });
    expect(parseRoute('#/comments/abc12')).toEqual({ page: 'thread', postId: 'abc12', commentId: undefined });
    expect(parseRoute('#/comments/abc12/def34')).toEqual({ page: 'thread', postId: 'abc12', commentId: 'def34' });
  });

  it('falls back to Subs', () => {
    expect(parseRoute('')).toEqual({ page: 'subs' });
    expect(parseRoute('#/nonsense')).toEqual({ page: 'subs' });
    expect(parseRoute('#/r/../x')).toEqual({ page: 'subs' });
  });

  it('reads back what routeHref writes', () => {
    for (const route of [{ page: 'saved' }, { page: 'subreddit', name: 'pics' }, { page: 'thread', postId: 'a1', commentId: 'b2' }] as const) {
      expect(parseRoute(routeHref(route))).toEqual({ commentId: undefined, ...route });
    }
  });
});

describe('routeForRedditUrl', () => {
  it('opens threads and subreddits in rd3k', () => {
    expect(routeForRedditUrl('https://www.reddit.com/r/pics/comments/abc12/some_title/')).toEqual({ page: 'thread', postId: 'abc12', commentId: undefined });
    expect(routeForRedditUrl('https://old.reddit.com/r/pics/comments/abc12/some_title/def34/?context=3')).toEqual({ page: 'thread', postId: 'abc12', commentId: 'def34' });
    expect(routeForRedditUrl('https://redd.it/abc12')).toEqual({ page: 'thread', postId: 'abc12' });
    expect(routeForRedditUrl('/r/AskReddit')).toEqual({ page: 'subreddit', name: 'AskReddit' });
    expect(routeForRedditUrl('https://www.reddit.com/r/popular/')).toEqual({ page: 'popular' });
  });

  it('leaves other links alone', () => {
    expect(routeForRedditUrl('https://example.com/r/pics')).toBeUndefined();
    expect(routeForRedditUrl('https://www.reddit.com/user/someone')).toBeUndefined();
    expect(routeForRedditUrl('https://www.reddit.com/r/pics/wiki/index')).toBeUndefined();
  });
});

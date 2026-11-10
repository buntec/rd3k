import { type Post, fetchFeed, fetchSubreddit, hide } from '@/utils/reddit';
import { type ItemList, createList } from '../posts/list';
import { PostListView } from '../posts/PostListView';

// Unlike subscriptions these aren't stored: Reddit picks anew on every visit.
const feed = createList(fetchFeed);
const popular = createList((after) => fetchSubreddit('popular', after));

/** The home feed, as Reddit's "Best" picks it, without ads. */
export function FeedPage() {
  return (
    <PostListView
      title="Feed"
      list={feed}
      loadingText="Loading your feed…"
      empty={{ title: 'Nothing in your feed', description: "Make sure you're logged in to Reddit in this browser." }}
      onHide={(post) => hidePost(feed, post)}
    />
  );
}

/** r/popular: what's popular across Reddit */
export function PopularPage() {
  return (
    <PostListView
      title="Popular"
      list={popular}
      loadingText="Loading popular posts…"
      empty={{ title: 'Nothing popular right now' }}
      onHide={(post) => hidePost(popular, post)}
    />
  );
}

/** Hides the post on Reddit, so it doesn't come back, with Undo in its place. */
export function hidePost(list: ItemList<Post>, post: Post) {
  void list.remove(post.fullname, {
    message: 'Post hidden',
    send: () => hide(post.fullname, true),
    undo: () => hide(post.fullname, false),
  });
}

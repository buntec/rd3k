import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useToast } from '@astryxdesign/core/Toast';
import { type Post, fetchSubreddit } from '@/utils/reddit';
import { hidePost } from '../feed/FeedPage';
import { type ItemList, createList } from '../posts/list';
import { PostListView } from '../posts/PostListView';
import { key, setSubscription, useSubscriptions } from '../subscriptions/store';

// One list per subreddit visited, so going back to one keeps its place.
const lists = new Map<string, ItemList<Post>>();

function listFor(name: string): ItemList<Post> {
  let list = lists.get(key(name));
  if (!list) {
    list = createList((after) => fetchSubreddit(name, after));
    lists.set(key(name), list);
  }
  return list;
}

/**
 * A subreddit's posts in its default (hot) order: Reddit blocks the JSON of
 * every other order.
 */
export function SubredditPage({ name }: { name: string }) {
  const list = listFor(name);
  return (
    <PostListView
      // A new subreddit starts with a fresh search and scroll position.
      key={key(name)}
      title={`r/${name}`}
      headerContent={<SubscribeButton name={name} />}
      list={list}
      loadingText={`Loading r/${name}…`}
      empty={{ title: `Nothing in r/${name}`, description: "It may be private, banned, or misspelled." }}
      showSubreddit={false}
      onHide={(post) => hidePost(list, post)}
    />
  );
}

function SubscribeButton({ name }: { name: string }) {
  const { subreddits } = useSubscriptions();
  const showToast = useToast();
  const [isPending, setIsPending] = useState(false);
  const isSubscribed = subreddits.some((s) => key(s.name) === key(name));
  return (
    <Button
      label={isSubscribed ? 'Unsubscribe' : 'Subscribe'}
      variant={isSubscribed ? 'secondary' : 'primary'}
      size="sm"
      isLoading={isPending}
      onClick={async () => {
        setIsPending(true);
        try {
          await setSubscription(name, !isSubscribed);
          if (!isSubscribed) showToast({ body: `Subscribed to r/${name}` });
        } catch (err) {
          console.warn(err);
          showToast({ type: 'error', body: err instanceof Error ? err.message : "That didn't work" });
        } finally {
          setIsPending(false);
        }
      }}
    />
  );
}

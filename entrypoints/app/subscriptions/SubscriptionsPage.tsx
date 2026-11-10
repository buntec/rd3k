import { memo, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import type { NewPost, Subreddit } from '@/utils/reddit';
import { compactNumber, countOf, fullDate, timeAgo } from '../posts/format';
import { subredditHref, threadHref } from '../router';
import { foldForSearch, useSearchShortcut } from '../search';
import { AddToGroupButton, GroupTokens, GroupsNav } from './GroupControls';
import { useGroups, useSubredditFilter } from './groups';
import { POSTS_PER_SUB_CHOICES, type PostsPerSub, setPostsPerSub, usePostsPerSub } from './postsPerSub';
import { type Feed, key, refresh, refreshStaleFeeds, setSubscription, useSubscriptions } from './store';

export function SubscriptionsPage() {
  const { subreddits, feeds, status, isRefreshing } = useSubscriptions();
  const postsPerSub = usePostsPerSub();
  const { isLoaded: groupsLoaded } = useGroups();
  const { filter, group: filterGroup, includes } = useSubredditFilter();
  const [sort, setSort] = useState<Sort>('newest');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  // Updates the feeds that got old, every minute while the page is shown and
  // right away on coming back to the browser tab.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshStaleFeeds();
    };
    const timer = setInterval(refreshIfVisible, 60 * 1000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, []);

  const visible = useMemo(() => {
    const direction = sort === 'oldest' ? -1 : 1;
    const latest = (s: Subreddit) => feeds[key(s.name)]?.posts[0]?.created ?? 0;
    return [...subreddits]
      .sort((a, b) => {
        // Subreddits still loading go last either way, rather than jump about
        // at the top of the oldest first.
        const isLoadingA = !feeds[key(a.name)];
        const isLoadingB = !feeds[key(b.name)];
        if (isLoadingA || isLoadingB) return Number(isLoadingA) - Number(isLoadingB);
        return direction * (latest(b) - latest(a));
      })
      .filter((s) => includes(s.name) && matchesQuery(s, feeds[key(s.name)], postsPerSub, deferredQuery));
  }, [subreddits, feeds, sort, postsPerSub, deferredQuery, includes]);

  // Only the first subreddits render, and more as the end of the list scrolls
  // into view. A new search, group or sort starts again from the top.
  const [shownCount, setShownCount] = useState(SUBS_PER_PAGE);
  const [shownView, setShownView] = useState({ query: deferredQuery, filter, sort });
  if (shownView.query !== deferredQuery || shownView.filter !== filter || shownView.sort !== sort) {
    setShownView({ query: deferredQuery, filter, sort });
    setShownCount(SUBS_PER_PAGE);
  }
  const shown = visible.slice(0, shownCount);

  // Another group, e.g. picked by a subreddit's token far down the list, shows
  // from its top. Only on a change, as Activity runs effects again whenever
  // the page is shown.
  const contentRef = useRef<HTMLDivElement>(null);
  const scrolledFilter = useRef(filter);
  useEffect(() => {
    if (scrolledFilter.current === filter) return;
    scrolledFilter.current = filter;
    contentRef.current?.scrollTo({ top: 0 });
  }, [filter]);

  return (
    <Layout
      header={
        <LayoutHeader hasDivider padding={6}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={1}>Subs</Heading>
            <TextInput
              ref={searchRef}
              label="Search subreddits and posts"
              isLabelHidden
              placeholder="Search subreddits and posts"
              value={query}
              onChange={setQuery}
              hasClear
              autoComplete="off"
              width={280}
            />
            <StackItem size="fill">
              <span className={status.isError ? 'status error' : 'status'} role="status">
                <Text type="supporting" color="inherit">
                  {status.text}
                </Text>
              </span>
            </StackItem>
            <Selector
              label="Sort subreddits"
              isLabelHidden
              variant="secondary"
              options={SORT_OPTIONS}
              value={sort}
              onChange={(value) => {
                setSort(value as Sort);
                contentRef.current?.scrollTo({ top: 0 });
              }}
            />
            <Selector
              label="Posts per subreddit"
              isLabelHidden
              variant="secondary"
              options={POSTS_PER_SUB_CHOICES.map((n) => ({ value: String(n), label: `${n} per subreddit` }))}
              value={String(postsPerSub)}
              onChange={(value) => setPostsPerSub(Number(value) as PostsPerSub)}
            />
            <Button label="Refresh" isLoading={isRefreshing} onClick={() => void refresh(true)} />
          </HStack>
        </LayoutHeader>
      }
      start={<GroupsNav subreddits={subreddits} filter={filter} />}
      content={
        <LayoutContent ref={contentRef} padding={6}>
          {visible.length === 0 && subreddits.length > 0 && groupsLoaded ? (
            <EmptyState
              headingLevel={2}
              isCompact
              {...(deferredQuery
                ? { title: 'No matching subreddits' }
                : filter === 'ungrouped'
                  ? { title: 'Every subreddit is in a group' }
                  : {
                      title: `No subreddits in ${filterGroup?.name}`,
                      description: 'Add subreddits with the Add to group button next to each.',
                    })}
            />
          ) : (
            <VStack gap={4} maxWidth={1600}>
              {shown.map((subreddit, i) => (
                <VStack key={subreddit.id} gap={4}>
                  {i > 0 && <Divider />}
                  <SubredditSection subreddit={subreddit} feed={feeds[key(subreddit.name)]} postsPerSub={postsPerSub} />
                </VStack>
              ))}
              {shown.length < visible.length && (
                <ShowMore shownCount={shownCount} onShowMore={() => setShownCount(shownCount + SUBS_PER_PAGE)} />
              )}
            </VStack>
          )}
        </LayoutContent>
      }
    />
  );
}

const SUBS_PER_PAGE = 30;

/** Which subreddits come first: those with the newest posts, or the quietest */
type Sort = 'newest' | 'oldest';

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Recently posted in first' },
  // To find the subreddits that went quiet
  { value: 'oldest', label: 'Least recently posted in first' },
];

/** Shows more subreddits once the user scrolls near the end of the list. */
function ShowMore({ shownCount, onShowMore }: { shownCount: number; onShowMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const showMore = useEffectEvent(onShowMore);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) showMore();
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shownCount]);

  return <div ref={ref} />;
}

/** Whether the subreddit's name or one of its shown post titles contains the query. */
function matchesQuery(subreddit: Subreddit, feed: Feed | undefined, postsPerSub: number, query: string) {
  if (!query) return true;
  const posts = (feed?.posts ?? []).slice(0, postsPerSub);
  return [subreddit.name, subreddit.title, ...posts.map((p) => p.title)].some((text) =>
    foldForSearch(text).includes(query),
  );
}

// Memoized so progress updates during a refresh only re-render the subreddits
// whose feed changed.
const SubredditSection = memo(function SubredditSection({
  subreddit,
  feed,
  postsPerSub,
}: {
  subreddit: Subreddit;
  feed: Feed | undefined;
  postsPerSub: number;
}) {
  const posts = (feed?.posts ?? []).slice(0, postsPerSub);
  return (
    <section>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <a className="subreddit-header" href={subredditHref(subreddit.name)}>
                <HStack gap={2} vAlign="center">
                  <Avatar src={subreddit.icon} name={subreddit.name} size={32} tooltip={false} />
                  <span className="subreddit-name">
                    <Text weight="medium" size="base">
                      r/{subreddit.name}
                    </Text>
                  </span>
                  {posts[0] && (
                    <Text type="supporting">
                      <time title={fullDate(posts[0].created)}>{timeAgo(posts[0].created)}</time>
                    </Text>
                  )}
                </HStack>
              </a>
              {/* Outside the link, which can't hold their buttons */}
              <GroupTokens subreddit={subreddit.name} />
            </HStack>
          </StackItem>
          <AddToGroupButton subreddit={subreddit.name} />
          <UnsubscribeButton subreddit={subreddit} />
        </HStack>
        {posts.length ? (
          <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
            {posts.map((post) => (
              <PostTile key={post.id} post={post} />
            ))}
          </Grid>
        ) : (
          <Text type="supporting">{feed ? 'No posts' : 'Loading…'}</Text>
        )}
      </VStack>
    </section>
  );
});

/** First click asks for confirmation, a second click within a few seconds unsubscribes. */
function UnsubscribeButton({ subreddit }: { subreddit: Subreddit }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'pending'>('idle');
  const showToast = useToast();

  useEffect(() => {
    if (state !== 'confirm') return;
    const timer = setTimeout(() => setState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'idle') {
    return <Button label="Unsubscribe" variant="ghost" size="sm" onClick={() => setState('confirm')} />;
  }
  return (
    <Button
      label="Confirm unsubscribe"
      variant="destructive"
      size="sm"
      isLoading={state === 'pending'}
      onClick={async () => {
        setState('pending');
        try {
          // On success the subreddit, and with it this button, goes away.
          await setSubscription(subreddit.name, false);
        } catch (err) {
          console.warn(err);
          showToast({ type: 'error', body: err instanceof Error ? err.message : "That didn't work" });
          setState('idle');
        }
      }}
    />
  );
}

function PostTile({ post }: { post: NewPost }) {
  const isBlurred = post.isNsfw || post.isSpoiler;
  return (
    <a className="post-tile" href={threadHref(post.id)} data-tooltip={post.title}>
      <HStack gap={2} vAlign="start">
        {post.thumbnail && (
          <span className="tile-thumbnail">
            <img className={isBlurred ? 'thumbnail-image blurred' : 'thumbnail-image'} src={post.thumbnail} alt="" loading="lazy" />
          </span>
        )}
        <StackItem size="fill">
          <VStack gap={1}>
            <span className="post-title">
              <Text weight="medium" maxLines={3} hasTruncateTooltip={false}>
                {post.title}
              </Text>
            </span>
            <HStack gap={1} vAlign="center" wrap="wrap">
              {post.score !== undefined && (
                <>
                  <Text type="supporting">{compactNumber(post.score)} points</Text>
                  <Text type="supporting">·</Text>
                </>
              )}
              {post.comments !== undefined && (
                <>
                  <Text type="supporting">
                    <span className="detail">
                      <Icon icon={MessageSquare} size="xsm" />
                      {countOf(post.comments, 'comment')}
                    </span>
                  </Text>
                  <Text type="supporting">·</Text>
                </>
              )}
              <Text type="supporting">
                <time title={fullDate(post.created)}>{timeAgo(post.created)}</time>
              </Text>
            </HStack>
          </VStack>
        </StackItem>
      </HStack>
    </a>
  );
}

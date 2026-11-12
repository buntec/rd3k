import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Post, SavedComment } from '@/utils/reddit';
import { BackToTop } from '../BackToTop';
import { subredditHref, threadHref } from '../router';
import { foldForSearch, useSearchShortcut } from '../search';
import { fullDate, timeAgo } from './format';
import { Html } from './Html';
import type { ItemList, ListState, Removal } from './list';
import { PostRow } from './PostRow';

export type ListedItem = Post | SavedComment;

/**
 * A page listing posts (and, in Saved, comments) from Reddit, loading more
 * as the end scrolls into view. `onHide` adds Hide to each post's menu.
 */
export function PostListView<T extends ListedItem>({
  title,
  headerContent,
  list,
  loadingText,
  empty,
  showSubreddit = true,
  onHide,
}: {
  title: React.ReactNode;
  /** More controls in the header, e.g. a subreddit's Subscribe button */
  headerContent?: React.ReactNode;
  list: ItemList<T>;
  loadingText: string;
  empty: { title: string; description?: string };
  showSubreddit?: boolean;
  onHide?: (post: Post) => void;
}) {
  const { items, after, loading, error, removalError, removals } = list.use();
  const status = loading === 'refresh' ? loadingText : (error ?? removalError);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useSearchShortcut(searchRef);
  const matching = deferredQuery ? items.filter((item) => matchesQuery(item, deferredQuery)) : items;

  return (
    <Layout
      contentWidth={1100}
      header={
        <LayoutHeader hasDivider padding={6}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={1}>{title}</Heading>
            {headerContent}
            <TextInput
              ref={searchRef}
              label="Search the posts loaded"
              isLabelHidden
              placeholder="Search"
              value={query}
              onChange={setQuery}
              hasClear
              autoComplete="off"
              width={240}
            />
            <StackItem size="fill">
              <span className={error || removalError ? 'status error' : 'status'} role="status">
                <Text type="supporting" color="inherit">
                  {status}
                </Text>
              </span>
            </StackItem>
            <Button label="Refresh" isLoading={loading === 'refresh'} onClick={() => void list.refresh()} />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent ref={contentRef} padding={6}>
          {items.length === 0 ? (
            loading === 'idle' && !error && <EmptyState title={empty.title} description={empty.description} headingLevel={2} />
          ) : (
            <VStack gap={6}>
              {deferredQuery && matching.length === 0 && (
                <EmptyState
                  title="No matching posts"
                  description={after ? 'Only the posts loaded so far were searched.' : undefined}
                  headingLevel={2}
                  isCompact
                />
              )}
              <List hasDividers edge="flush">
                {matching.map((item) => {
                  const removal = removals[item.fullname];
                  if (removal) {
                    return (
                      <RemovedRow key={item.fullname} removal={removal} onUndo={() => void list.undoRemoval(item.fullname)} />
                    );
                  }
                  return item.kind === 'saved-comment' ? (
                    <SavedCommentRow key={item.fullname} comment={item} />
                  ) : (
                    <PostRow key={item.fullname} post={item} showSubreddit={showSubreddit} onHide={onHide} />
                  );
                })}
              </List>
              {after && (
                <ShowMore
                  list={list}
                  loading={loading}
                  // A search that matches little would otherwise keep loading
                  // page after page, eating into Reddit's rate limit.
                  isAutomatic={!deferredQuery && error === undefined}
                />
              )}
            </VStack>
          )}
          <BackToTop scrollRef={contentRef} />
        </LayoutContent>
      }
    />
  );
}

function matchesQuery(item: ListedItem, query: string) {
  const texts =
    item.kind === 'saved-comment'
      ? [item.postTitle, item.subreddit, item.author]
      : [item.title, item.subreddit, item.author, item.flair ?? ''];
  return texts.some((text) => foldForSearch(text).includes(query));
}

/**
 * Loads the next page once the user scrolls near the end, if `isAutomatic`.
 * The button stays as a fallback, and is the only way after a failure, so a
 * broken request isn't repeated on every scroll.
 */
function ShowMore<T extends ListedItem>({
  list,
  loading,
  isAutomatic,
}: {
  list: ItemList<T>;
  loading: ListState<T>['loading'];
  isAutomatic: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading !== 'idle' || !isAutomatic || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void list.loadMore();
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [list, loading, isAutomatic]);

  return (
    <div ref={ref}>
      <Center>
        <Button label="Show more" isLoading={loading === 'more'} onClick={() => void list.loadMore()} />
      </Center>
    </div>
  );
}

/** Takes the place of a post the user hid, with Undo */
function RemovedRow({ removal, onUndo }: { removal: Removal; onUndo: () => void }) {
  return (
    <ListItem
      label={<Text type="supporting">{removal.message}</Text>}
      endContent={
        removal.undo && (
          <Button
            label="Undo"
            size="sm"
            variant="ghost"
            isDisabled={removal.status === 'sending'}
            isLoading={removal.status === 'undoing'}
            onClick={onUndo}
          />
        )
      }
    />
  );
}

function SavedCommentRow({ comment }: { comment: SavedComment }) {
  return (
    <ListItem
      align="start"
      label={
        <VStack gap={1}>
          <HStack gap={1} vAlign="center" wrap="wrap">
            <Text type="supporting">Comment by u/{comment.author} on</Text>
            <a className="post-title" href={threadHref(comment.postId, comment.id)}>
              <Text weight="medium">{comment.postTitle}</Text>
            </a>
          </HStack>
          <HStack gap={1} vAlign="center" wrap="wrap">
            <a className="subtle-link" href={subredditHref(comment.subreddit)}>
              <Text type="supporting" weight="medium">
                r/{comment.subreddit}
              </Text>
            </a>
            <Text type="supporting">·</Text>
            <Text type="supporting">
              <time title={fullDate(comment.created)}>{timeAgo(comment.created)}</time>
            </Text>
          </HStack>
          <div className="selftext">
            <Html html={comment.bodyHtml} media={comment.media} />
          </div>
        </VStack>
      }
    />
  );
}

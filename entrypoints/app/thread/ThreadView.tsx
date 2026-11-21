import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ExternalLink, Link as LinkIcon, Minus, Plus } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import {
  type Comment,
  type CommentNode,
  type CommentSort,
  type MoreComments,
  type Thread,
  fetchCommentThread,
  fetchCommentTree,
  fetchThread,
  leavesOutComments,
} from '@/utils/reddit';
import { onAccountChange } from '../account';
import { compactNumber, countOf, fullDate, timeAgo } from '../posts/format';
import { Html } from '../posts/Html';
import { PostMedia } from '../posts/PostMedia';
import { PostDetails } from '../posts/PostRow';
import { SaveButton, Votes } from '../posts/Votes';
import { threadHref } from '../router';

const SORTS: { value: CommentSort; label: string }[] = [
  { value: 'confidence', label: 'Best' },
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
  { value: 'controversial', label: 'Controversial' },
  { value: 'old', label: 'Old' },
  { value: 'qa', label: 'Q&A' },
];

// Threads seen recently, so going back to one from a link in it doesn't
// spend another request of Reddit's rate limit.
const cache = new Map<string, Thread>();
const CACHE_SIZE = 20;

// Reddit takes seconds to send 500 comments from a busy thread, so a thread
// shows its first comments, quick to send, while the rest load.
const FIRST_LIMIT = 100;

// Votes and saves are the account's: switching accounts loads threads again.
// Keys hold the count of switches, so loads under way then don't count.
let switches = 0;
const switchListeners = new Set<() => void>();
onAccountChange((_name, previous) => {
  // A first confirmation: loaded with the account's login all along
  if (previous === undefined) return;
  switches++;
  cache.clear();
  for (const listener of switchListeners) listener();
});

function useSwitches(): number {
  return useSyncExternalStore(
    (onChange) => {
      switchListeners.add(onChange);
      return () => switchListeners.delete(onChange);
    },
    () => switches,
  );
}

function remember(cacheKey: string, thread: Thread) {
  cache.delete(cacheKey);
  cache.set(cacheKey, thread);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** A thread loading: its first comments, then all of them */
interface Load {
  first: Promise<Thread>;
  /** All the comments, which the cache holds from then on */
  all: Promise<Thread>;
  /** Replies loaded meanwhile, to keep in `all` */
  replies: Map<string, Comment>;
}

// Threads loading, so a view that opens one again, e.g. reopened or mounted
// twice by StrictMode, waits for the same requests instead of sending more.
const loads = new Map<string, Load>();

function load(cacheKey: string, postId: string, commentId: string | undefined, sort: CommentSort): Load {
  const existing = loads.get(cacheKey);
  if (existing) return existing;
  const replies = new Map<string, Comment>();
  const first = commentId ? fetchCommentThread(postId, commentId, sort) : fetchThread(postId, sort, FIRST_LIMIT);
  const all = first.then(async (thread) => {
    let full = thread;
    if (hasRest(thread, commentId)) {
      try {
        full = await fetchThread(postId, sort);
      } catch (err) {
        // The first comments are still worth reading.
        console.warn(err);
      }
    }
    for (const comment of replies.values()) full = { ...full, comments: replaceIn(full.comments, comment) };
    remember(cacheKey, full);
    return full;
  });
  // Once loaded, the thread is in the cache; once failed, opening it tries again.
  all.catch(() => {}).finally(() => loads.delete(cacheKey));
  const started = { first, all, replies };
  loads.set(cacheKey, started);
  return started;
}

/** Whether a thread's first comments leave out more to load */
function hasRest(thread: Thread, commentId: string | undefined): boolean {
  return !commentId && leavesOutComments(thread.comments);
}

/**
 * A post with its comments, the content of the thread dialog: all those
 * Reddit sends in one request, about 500, or one comment's replies when
 * `commentId` is given. The first 100 show while the rest load.
 */
export function ThreadView({
  postId,
  commentId,
  onClose,
}: {
  postId: string;
  commentId?: string;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<CommentSort>('confidence');
  const switchCount = useSwitches();
  const cacheKey = `${switchCount}/${postId}/${commentId ?? ''}/${sort}`;
  const [thread, setThread] = useState<Thread | undefined>(() => cache.get(cacheKey));
  const [error, setError] = useState<string>();
  const [isLoadingRest, setIsLoadingRest] = useState(false);

  useEffect(() => {
    const cached = cache.get(cacheKey);
    setThread(cached);
    setError(undefined);
    setIsLoadingRest(false);
    if (cached) return;
    let isCurrent = true;
    const { first, all } = load(cacheKey, postId, commentId, sort);
    first.then(
      (loaded) => {
        if (!isCurrent) return;
        setThread(loaded);
        setIsLoadingRest(hasRest(loaded, commentId));
      },
      (err: unknown) => {
        console.warn(err);
        if (isCurrent) setError(err instanceof Error ? err.message : String(err));
      },
    );
    // Runs after `first`'s callback, which it waits for
    all.then(
      (loaded) => {
        if (!isCurrent) return;
        setThread(loaded);
        setIsLoadingRest(false);
      },
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, [postId, commentId, sort, cacheKey]);

  // Loading more replies replaces a comment with a fuller copy of itself.
  const replaceComment = useCallback(
    (comment: Comment) => {
      const loading = loads.get(cacheKey);
      loading?.replies.set(comment.id, comment);
      setThread((current) => {
        if (!current) return current;
        const next = { ...current, comments: replaceIn(current.comments, comment) };
        // A thread still loading is remembered once it has loaded.
        if (!loading) remember(cacheKey, next);
        return next;
      });
    },
    [cacheKey],
  );

  useEffect(() => {
    document.title = thread ? `${thread.post.title} · rd3k` : 'rd3k';
  }, [thread]);

  if (error) {
    return (
      <ThreadFrame title="Thread" onClose={onClose}>
        <EmptyState title="Couldn't load this thread" description={error} headingLevel={1} />
      </ThreadFrame>
    );
  }

  if (!thread) {
    return (
      <ThreadFrame title="Thread" onClose={onClose}>
        <Text type="supporting">Loading…</Text>
      </ThreadFrame>
    );
  }

  const { post, comments } = thread;
  return (
    <ThreadFrame
      title={post.title}
      onClose={onClose}
      endContent={
        <IconButton
          label="Open on Reddit"
          icon={<Icon icon={ExternalLink} />}
          variant="ghost"
          size="sm"
          onClick={() => window.open(`https://www.reddit.com${post.permalink}`, '_blank', 'noopener')}
        />
      }
    >
      <VStack gap={6}>
        <VStack as="article" gap={3}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <PostDetails post={post} />
            {post.flair && <Token label={post.flair} size="sm" />}
            {post.isNsfw && <Token label="NSFW" color="red" size="sm" />}
            {post.isSpoiler && <Token label="Spoiler" size="sm" />}
          </HStack>
          {post.selftextHtml && (
            <div className="selftext">
              <Html html={post.selftextHtml} media={post.selftextMedia} />
            </div>
          )}
          <PostMedia post={post} />
          {!post.isSelf && post.media.kind === 'none' && (
            <a className="external-link" href={post.url} target="_blank" rel="noopener noreferrer">
              <HStack gap={1} vAlign="center">
                <Icon icon={LinkIcon} size="sm" />
                <Text size="sm" color="inherit">
                  {post.url}
                </Text>
              </HStack>
            </a>
          )}
          <HStack gap={2} vAlign="center">
            <Votes fullname={post.fullname} score={post.score} likes={post.likes} isDisabled={post.isArchived} />
            <SaveButton fullname={post.fullname} saved={post.saved} />
            {post.isLocked && <Token label="Locked" size="sm" />}
            {post.isArchived && <Token label="Archived" size="sm" />}
          </HStack>
        </VStack>
        <Divider />
        <HStack gap={4} vAlign="center" wrap="wrap">
          <Heading level={2}>{countOf(post.comments, 'comment')}</Heading>
          <StackItem size="fill" />
          <Selector
            label="Sort comments"
            isLabelHidden
            variant="secondary"
            options={SORTS}
            value={sort}
            onChange={(value) => setSort(value as CommentSort)}
          />
        </HStack>
        {commentId && (
          <HStack gap={2} vAlign="center">
            <Text type="supporting">Showing a single comment's thread.</Text>
            <Button label="Show all comments" size="sm" variant="secondary" href={threadHref(postId)} />
          </HStack>
        )}
        {comments.length === 0 ? (
          <Text type="supporting">No comments yet</Text>
        ) : (
          <CommentList
            nodes={comments}
            postId={post.id}
            permalink={post.permalink}
            sort={sort}
            isLoadingRest={isLoadingRest}
            onReplace={replaceComment}
          />
        )}
      </VStack>
    </ThreadFrame>
  );
}

/**
 * The dialog's frame: a header that stays while the thread scrolls under it,
 * with the post's title and a close button. Esc and a click outside close too.
 */
function ThreadFrame({
  title,
  endContent,
  onClose,
  children,
}: {
  title: string;
  endContent?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Layout
      padding={6}
      header={<DialogHeader title={title} endContent={endContent} onOpenChange={(isOpen) => !isOpen && onClose()} />}
      content={<LayoutContent>{children}</LayoutContent>}
    />
  );
}

/** The nodes with the comment of the same ID swapped for `comment` */
function replaceIn(nodes: CommentNode[], comment: Comment): CommentNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'comment') return node;
    if (node.id === comment.id) return comment;
    return { ...node, replies: replaceIn(node.replies, comment) };
  });
}

interface TreeProps {
  postId: string;
  /** The post's thread on reddit.com, for what rd3k can't load */
  permalink: string;
  sort: CommentSort;
  /** Whether the comments past the first are still loading */
  isLoadingRest: boolean;
  onReplace: (comment: Comment) => void;
}

function CommentList({ nodes, ...props }: TreeProps & { nodes: CommentNode[] }) {
  return (
    <VStack gap={4}>
      {nodes.map((node) =>
        node.kind === 'comment' ? (
          <CommentView key={node.id} comment={node} {...props} />
        ) : (
          <MoreButton key={`${node.parentId}/${node.id}`} more={node} {...props} />
        ),
      )}
    </VStack>
  );
}

const CommentView = memo(function CommentView({ comment, ...props }: TreeProps & { comment: Comment }) {
  // Comments Reddit collapses, e.g. for a low score, start collapsed here too.
  const [isCollapsed, setIsCollapsed] = useState(comment.isCollapsed);
  const author = (
    <HStack gap={1} vAlign="center" wrap="wrap">
      <IconButton
        label={isCollapsed ? 'Expand comment' : 'Collapse comment'}
        icon={<Icon icon={isCollapsed ? Plus : Minus} />}
        variant="ghost"
        size="sm"
        onClick={() => setIsCollapsed(!isCollapsed)}
      />
      <Text size="sm" weight="medium">
        u/{comment.author}
      </Text>
      {comment.isSubmitter && <Token label="OP" color="blue" size="sm" />}
      {comment.distinguished === 'moderator' && <Token label="Mod" color="green" size="sm" />}
      {comment.distinguished === 'admin' && <Token label="Admin" color="red" size="sm" />}
      {comment.isStickied && <Token label="Pinned" color="green" size="sm" />}
      <Text type="supporting">·</Text>
      <Text type="supporting">
        <time title={fullDate(comment.created)}>{timeAgo(comment.created)}</time>
        {comment.edited && <span title={`Edited ${fullDate(comment.edited)}`}> (edited)</span>}
      </Text>
      {isCollapsed && (
        <Text type="supporting">
          · {comment.isScoreHidden ? '' : `${comment.score} points · `}
          {countReplies(comment)} {countReplies(comment) === 1 ? 'reply' : 'replies'}
        </Text>
      )}
    </HStack>
  );
  if (isCollapsed) return <div className="comment">{author}</div>;
  return (
    <div className="comment">
      <VStack gap={1}>
        {author}
        <Html html={comment.bodyHtml} media={comment.media} />
        <HStack gap={1} vAlign="center">
          <Votes fullname={comment.fullname} score={comment.score} likes={comment.likes} isScoreHidden={comment.isScoreHidden} />
          <SaveButton fullname={comment.fullname} saved={comment.saved} />
          <Button label="Permalink" variant="ghost" size="sm" href={threadHref(props.postId, comment.id)} />
        </HStack>
        {comment.replies.length > 0 && (
          <div className="replies">
            <CommentList nodes={comment.replies} {...props} />
          </div>
        )}
      </VStack>
    </div>
  );
});

function countReplies(comment: Comment): number {
  return comment.replies.reduce(
    (sum, node) => sum + (node.kind === 'comment' ? 1 + countReplies(node) : node.count),
    0,
  );
}

/**
 * Comments the thread left out. Replies to a comment load with that
 * comment's own thread; Reddit blocks the route that loads the rest, so
 * those at the top level link to Reddit.
 */
function MoreButton({ more, postId, permalink, sort, isLoadingRest, onReplace }: TreeProps & { more: MoreComments }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const parentComment = more.parentId.startsWith('t1_') ? more.parentId.slice(3) : undefined;
  const label = more.isContinuation
    ? 'Continue this thread'
    : `${compactNumber(more.count)} more ${more.count === 1 ? 'reply' : 'replies'}`;

  if (!parentComment) {
    if (isLoadingRest) return <Text type="supporting">Loading more comments…</Text>;
    return (
      <Button
        label={`${countOf(more.count, 'more comment')} on Reddit`}
        variant="ghost"
        size="sm"
        href={`https://www.reddit.com${permalink}`}
        target="_blank"
      />
    );
  }
  return (
    <HStack gap={2} vAlign="center">
      <Button
        label={label}
        variant="ghost"
        size="sm"
        isLoading={state === 'loading'}
        onClick={async () => {
          setState('loading');
          try {
            onReplace(await fetchCommentTree(postId, parentComment, sort));
          } catch (err) {
            console.warn(err);
            setState('failed');
          }
        }}
      />
      {state === 'failed' && (
        <Text type="supporting">
          That didn't load.{' '}
          <a href={`https://www.reddit.com${permalink}${parentComment}/`} target="_blank" rel="noopener noreferrer">
            Open on Reddit
          </a>
        </Text>
      )}
    </HStack>
  );
}

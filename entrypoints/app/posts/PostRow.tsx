import { memo, useState } from 'react';
import { EllipsisVertical, EyeOff, ExternalLink, Film, Images, Image as ImageIcon, Link, Maximize2, MessageSquare, Minimize2, Text as TextIcon } from 'lucide-react';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import type { Post } from '@/utils/reddit';
import { subredditHref, threadHref } from '../router';
import { countOf, fullDate, timeAgo } from './format';
import { Html } from './Html';
import { PostMedia } from './PostMedia';
import { SaveButton, Votes } from './Votes';

/**
 * A post in a list: votes, thumbnail, title linking to its thread, and what
 * Reddit tells about it. Its media can be expanded in place.
 */
export const PostRow = memo(function PostRow({
  post,
  showSubreddit = true,
  onHide,
}: {
  post: Post;
  /** Off on a subreddit's own page, where it would repeat */
  showSubreddit?: boolean;
  /** Takes the post out of the list and hides it on Reddit */
  onHide?: (post: Post) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMedia = post.media.kind !== 'none' || Boolean(post.selftextHtml);
  const href = threadHref(post.id);
  return (
    <ListItem
      align="start"
      startContent={
        <HStack gap={2} vAlign="start">
          <Votes fullname={post.fullname} score={post.score} likes={post.likes} isDisabled={post.isArchived} />
          <a className="post-thumbnail" href={href} tabIndex={-1} aria-hidden>
            <Thumbnail post={post} />
          </a>
        </HStack>
      }
      label={
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <a className="post-title" href={href} data-tooltip={post.title}>
              <Text weight="medium" maxLines={3} hasTruncateTooltip={false}>
                {post.title}
              </Text>
            </a>
            {post.flair && <Token label={post.flair} size="sm" />}
            {post.isNsfw && <Token label="NSFW" color="red" size="sm" />}
            {post.isSpoiler && <Token label="Spoiler" size="sm" />}
            {post.isStickied && <Token label="Pinned" color="green" size="sm" />}
          </HStack>
          <PostDetails post={post} showSubreddit={showSubreddit} />
          {isExpanded && <ExpandedContent post={post} />}
        </VStack>
      }
      endContent={
        <HStack gap={1} vAlign="center">
          {hasMedia && (
            <IconButton
              label={isExpanded ? 'Collapse' : 'Expand'}
              icon={<Icon icon={isExpanded ? Minimize2 : Maximize2} />}
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            />
          )}
          <SaveButton fullname={post.fullname} saved={post.saved} />
          <DropdownMenu
            button={{
              label: 'More actions',
              isIconOnly: true,
              icon: <Icon icon={EllipsisVertical} />,
              variant: 'ghost',
              size: 'sm',
            }}
            hasChevron={false}
            alignment="end"
            items={[
              ...(onHide ? [{ label: 'Hide', icon: EyeOff, onClick: () => onHide(post) }] : []),
              {
                label: 'Open on Reddit',
                icon: ExternalLink,
                onClick: () => window.open(`https://www.reddit.com${post.permalink}`, '_blank', 'noopener'),
              },
              ...(post.isSelf
                ? []
                : [{ label: `Open link (${post.domain})`, icon: Link, onClick: () => window.open(post.url, '_blank', 'noopener') }]),
            ]}
          />
        </HStack>
      }
    />
  );
});

/** Subreddit, author, age, comments and, for links, their site */
export function PostDetails({ post, showSubreddit = true }: { post: Post; showSubreddit?: boolean }) {
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      {showSubreddit && (
        <>
          <a className="subtle-link" href={subredditHref(post.subreddit)}>
            <Text type="supporting" weight="medium">
              r/{post.subreddit}
            </Text>
          </a>
          <Text type="supporting">·</Text>
        </>
      )}
      <Text type="supporting">u/{post.author}</Text>
      <Text type="supporting">·</Text>
      <Text type="supporting">
        <time dateTime={new Date(post.created).toISOString()} title={fullDate(post.created)}>
          {timeAgo(post.created)}
        </time>
      </Text>
      <Text type="supporting">·</Text>
      <a className="subtle-link" href={threadHref(post.id)}>
        <Text type="supporting">
          <span className="detail">
            <Icon icon={MessageSquare} size="xsm" />
            {countOf(post.comments, 'comment')}
          </span>
        </Text>
      </a>
      {!post.isSelf && post.domain && !post.domain.startsWith('self.') && (
        <>
          <Text type="supporting">·</Text>
          <Text type="supporting">{post.domain}</Text>
        </>
      )}
      {post.crosspostFrom && (
        <>
          <Text type="supporting">·</Text>
          <Text type="supporting">crossposted from r/{post.crosspostFrom}</Text>
        </>
      )}
    </HStack>
  );
}

function ExpandedContent({ post }: { post: Post }) {
  return (
    <VStack gap={3}>
      {post.selftextHtml && <SelfText html={post.selftextHtml} />}
      <PostMedia post={post} />
    </VStack>
  );
}

function SelfText({ html }: { html: string }) {
  return (
    <div className="selftext">
      <Html html={html} />
    </div>
  );
}

/** The post's thumbnail, or an icon for its kind */
export function Thumbnail({ post }: { post: Post }) {
  const isBlurred = post.isNsfw || post.isSpoiler;
  if (post.thumbnail) {
    return (
      <img
        className={isBlurred ? 'thumbnail-image blurred' : 'thumbnail-image'}
        src={post.thumbnail.url}
        alt=""
        loading="lazy"
      />
    );
  }
  const icon =
    post.media.kind === 'video' ? Film
    : post.media.kind === 'gallery' ? Images
    : post.media.kind === 'image' ? ImageIcon
    : post.isSelf ? TextIcon
    : Link;
  return (
    <span className="thumbnail-icon">
      <Icon icon={icon} size="md" />
    </span>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { type Media, type Post, pickSize } from '@/utils/reddit';

/**
 * What a post shows besides its title: its image, gallery, video, or a link
 * to the video on another site. NSFW and spoiler media wait for a click.
 */
export function PostMedia({ post }: { post: Post }) {
  const isSensitive = post.isNsfw || post.isSpoiler;
  const [isRevealed, setIsRevealed] = useState(!isSensitive);
  if (post.media.kind === 'none') return null;
  if (!isRevealed) {
    return (
      <Button
        label={post.isNsfw ? 'Show NSFW media' : 'Show spoiler'}
        variant="secondary"
        size="sm"
        onClick={() => setIsRevealed(true)}
      />
    );
  }
  return <MediaView media={post.media} url={post.url} />;
}

function MediaView({ media, url }: { media: Media; url: string }) {
  switch (media.kind) {
    case 'image':
      return (
        <a className="media" href={media.image.url} target="_blank" rel="noopener noreferrer">
          <img
            className="media-image"
            src={pickSize(media.sizes, 1080)?.url ?? media.image.url}
            width={media.image.width || undefined}
            height={media.image.height || undefined}
            alt=""
          />
        </a>
      );
    case 'gallery':
      return <Gallery items={media.items} />;
    case 'video':
      return <Video media={media} />;
    case 'embed':
      return (
        <a className="media embed" href={url} target="_blank" rel="noopener noreferrer">
          {media.thumbnail && <img className="media-image" src={media.thumbnail.url} alt="" />}
          <span className="embed-label">
            <HStack gap={1} vAlign="center">
              <Icon icon={ExternalLink} size="sm" />
              <Text size="sm" color="inherit">
                {media.provider ? `Watch on ${media.provider}` : 'Open'}
              </Text>
            </HStack>
          </span>
        </a>
      );
    default:
      return null;
  }
}

function Gallery({ items }: { items: Extract<Media, { kind: 'gallery' }>['items'] }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  if (!item) return null;
  return (
    <VStack gap={2}>
      <a className="media" href={item.image.url} target="_blank" rel="noopener noreferrer">
        <img className="media-image" src={pickSize(item.sizes, 1080)?.url ?? item.image.url} alt="" />
      </a>
      <HStack gap={2} vAlign="center">
        <IconButton
          label="Previous image"
          icon={<Icon icon={ChevronLeft} />}
          variant="secondary"
          size="sm"
          isDisabled={index === 0}
          onClick={() => setIndex(index - 1)}
        />
        <Text type="supporting">
          {index + 1} of {items.length}
        </Text>
        <IconButton
          label="Next image"
          icon={<Icon icon={ChevronRight} />}
          variant="secondary"
          size="sm"
          isDisabled={index === items.length - 1}
          onClick={() => setIndex(index + 1)}
        />
        {item.caption && <Text type="supporting">{item.caption}</Text>}
      </HStack>
    </VStack>
  );
}

/**
 * A Reddit-hosted video. Its MP4 has no sound; the HLS stream does, which
 * Chrome and Firefox play through hls.js. GIFs loop silently.
 */
function Video({ media }: { media: Extract<Media, { kind: 'video' }> }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (media.isGif || !media.hls) {
      video.src = media.mp4;
      return;
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = media.hls;
      return;
    }
    let hls: { destroy(): void } | undefined;
    let isCancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (isCancelled) return;
      if (!Hls.isSupported()) {
        video.src = media.mp4;
        return;
      }
      // No worker: extension pages may not start one from a blob: URL.
      const instance = new Hls({ enableWorker: false });
      hls = instance;
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.warn('HLS failed, playing the silent MP4', data);
        instance.destroy();
        video.src = media.mp4;
      });
      instance.loadSource(media.hls!);
      instance.attachMedia(video);
    });
    return () => {
      isCancelled = true;
      hls?.destroy();
    };
  }, [media]);

  return (
    <video
      ref={ref}
      className="media-video"
      style={{ aspectRatio: `${media.width} / ${media.height}` }}
      controls={!media.isGif}
      autoPlay={media.isGif}
      loop={media.isGif}
      muted={media.isGif}
      playsInline
      preload="metadata"
    />
  );
}

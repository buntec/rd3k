// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseComments, parseNewPage, parsePost, parseSubreddit, pickSize } from './reddit';

// Trimmed to the fields rd3k reads, in the shape Reddit's JSON has them.
const base = {
  id: 'abc123',
  name: 't3_abc123',
  title: 'A title',
  subreddit: 'pics',
  author: 'someone',
  created_utc: 1_700_000_000,
  score: 42,
  num_comments: 7,
  permalink: '/r/pics/comments/abc123/a_title/',
};

describe('parsePost', () => {
  it('reads a text post', () => {
    const post = parsePost({
      ...base,
      is_self: true,
      url: 'https://www.reddit.com/r/pics/comments/abc123/a_title/',
      domain: 'self.pics',
      selftext_html: '<div class="md"><p>Hi</p></div>',
      thumbnail: 'self',
      likes: true,
      saved: true,
    });
    expect(post).toMatchObject({
      kind: 'post',
      id: 'abc123',
      fullname: 't3_abc123',
      created: 1_700_000_000_000,
      isSelf: true,
      selftextHtml: '<div class="md"><p>Hi</p></div>',
      likes: true,
      saved: true,
      media: { kind: 'none' },
    });
    // "self" stands for Reddit's own icon, not an image.
    expect(post.thumbnail).toBeUndefined();
  });

  it('reads an image post, unescaping preview URLs', () => {
    const post = parsePost({
      ...base,
      post_hint: 'image',
      url: 'https://i.redd.it/xyz.jpg',
      preview: {
        images: [
          {
            source: { url: 'https://preview.redd.it/xyz.jpg?width=2000&amp;s=sig', width: 2000, height: 1500 },
            resolutions: [
              { url: 'https://preview.redd.it/xyz.jpg?width=108&amp;s=a', width: 108, height: 81 },
              { url: 'https://preview.redd.it/xyz.jpg?width=320&amp;s=b', width: 320, height: 240 },
            ],
          },
        ],
      },
    });
    expect(post.thumbnail?.url).toBe('https://preview.redd.it/xyz.jpg?width=320&s=b');
    expect(post.media).toMatchObject({ kind: 'image', image: { url: 'https://i.redd.it/xyz.jpg', width: 2000 } });
  });

  it('reads a gallery in its order, skipping items still processing', () => {
    const post = parsePost({
      ...base,
      is_gallery: true,
      gallery_data: { items: [{ media_id: 'b', caption: 'Second' }, { media_id: 'gone' }, { media_id: 'a' }] },
      media_metadata: {
        a: { status: 'valid', s: { u: 'https://preview.redd.it/a.jpg?&amp;s=1', x: 800, y: 600 }, p: [] },
        b: { status: 'valid', s: { u: 'https://preview.redd.it/b.jpg', x: 800, y: 600 }, p: [{ u: 'https://preview.redd.it/b-small.jpg', x: 320, y: 240 }] },
        gone: { status: 'failed' },
      },
    });
    expect(post.media.kind).toBe('gallery');
    if (post.media.kind !== 'gallery') return;
    expect(post.media.items.map((i) => [i.image.url, i.caption])).toEqual([
      ['https://preview.redd.it/b.jpg', 'Second'],
      ['https://preview.redd.it/a.jpg?&s=1', undefined],
    ]);
    // The first image's smallest size that's still sharp as a thumbnail
    expect(post.thumbnail?.url).toBe('https://preview.redd.it/b-small.jpg');
  });

  it('reads a Reddit video with its HLS stream', () => {
    const post = parsePost({
      ...base,
      is_video: true,
      media: {
        reddit_video: {
          hls_url: 'https://v.redd.it/v1/HLSPlaylist.m3u8?a=1&amp;v=1',
          fallback_url: 'https://v.redd.it/v1/DASH_720.mp4?source=fallback',
          width: 1280,
          height: 720,
          is_gif: false,
        },
      },
    });
    expect(post.media).toEqual({
      kind: 'video',
      hls: 'https://v.redd.it/v1/HLSPlaylist.m3u8?a=1&v=1',
      mp4: 'https://v.redd.it/v1/DASH_720.mp4?source=fallback',
      width: 1280,
      height: 720,
      isGif: false,
    });
  });

  it("takes a crosspost's media from the original", () => {
    const post = parsePost({
      ...base,
      crosspost_parent_list: [
        { ...base, id: 'orig', name: 't3_orig', subreddit: 'videos', is_video: true, media: { reddit_video: { fallback_url: 'https://v.redd.it/o/DASH_480.mp4' } } },
      ],
    });
    expect(post.id).toBe('abc123');
    expect(post.crosspostFrom).toBe('videos');
    expect(post.media.kind).toBe('video');
  });

  it('reads a YouTube link as an embed with its thumbnail', () => {
    const post = parsePost({
      ...base,
      post_hint: 'rich:video',
      url: 'https://www.youtube.com/watch?v=x',
      domain: 'youtube.com',
      media: { oembed: { provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', thumbnail_width: 480, thumbnail_height: 360 } },
    });
    expect(post.media).toMatchObject({ kind: 'embed', provider: 'YouTube' });
    expect(post.thumbnail?.url).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
  });
});

describe('parseComments', () => {
  const comment = (id: string, replies: unknown = '') => ({
    kind: 't1',
    data: {
      id,
      name: `t1_${id}`,
      author: 'a',
      body_html: '<div class="md"><p>x</p></div>',
      score: 1,
      created_utc: 1_700_000_000,
      permalink: `/r/x/comments/p/_/${id}/`,
      replies,
    },
  });
  const listing = (...children: unknown[]) => ({ data: { children } });

  it('reads nested replies and what the thread left out', () => {
    const nodes = parseComments(
      listing(
        comment('c1', listing(comment('c2'), { kind: 'more', data: { id: 'c9', parent_id: 't1_c1', count: 12, children: ['c9', 'c10'] } })),
        comment('c3', listing({ kind: 'more', data: { id: '_', parent_id: 't1_c3', count: 0, children: [] } })),
        { kind: 'more', data: { id: 'c20', parent_id: 't3_p', count: 150, children: ['c20'] } },
      ) as never,
    );
    expect(nodes.map((n) => n.kind)).toEqual(['comment', 'comment', 'more']);
    const [first, second, third] = nodes;
    expect(first?.kind === 'comment' && first.replies.map((r) => r.kind)).toEqual(['comment', 'more']);
    expect(first?.kind === 'comment' && first.replies[1]).toMatchObject({ count: 12, parentId: 't1_c1', isContinuation: false });
    expect(second?.kind === 'comment' && second.replies[0]).toMatchObject({ parentId: 't1_c3', isContinuation: true });
    expect(third).toMatchObject({ parentId: 't3_p', count: 150 });
  });

  it('drops an empty "more" that has nothing to load', () => {
    expect(parseComments(listing({ kind: 'more', data: { id: 'x', parent_id: 't1_y', count: 0, children: ['x'] } }) as never)).toEqual([]);
  });

  it('reads no replies from an empty string', () => {
    expect(parseComments('')).toEqual([]);
  });
});

describe('parseNewPage', () => {
  // The attributes Reddit's web client puts on each post
  const post = (id: string, created: string, extra = '') =>
    `<shreddit-post id="t3_${id}" post-title="Post ${id}" permalink="/r/pics/comments/${id}/post/" created-timestamp="${created}" subreddit-prefixed-name="r/pics" author="u1" score="10" comment-count="3" ${extra}></shreddit-post>`;

  it('reads posts newest first, whatever the page order', () => {
    const posts = parseNewPage(
      `<html><body>${post('old', '2026-11-01T10:00:00.000000+0000', 'stickied')}${post('b', '2026-11-10T09:00:00.000000+0000')}${post('a', '2026-11-10T11:00:00.000000+0000', 'nsfw')}</body></html>`,
    );
    expect(posts.map((p) => p.id)).toEqual(['a', 'b', 'old']);
    expect(posts[0]).toMatchObject({
      fullname: 't3_a',
      title: 'Post a',
      subreddit: 'pics',
      score: 10,
      comments: 3,
      isNsfw: true,
      permalink: '/r/pics/comments/a/post/',
    });
  });

  // As Reddit's page renders a text post (November 2026, anonymized): the
  // author's avatar sits in the credit bar, on the same host as thumbnails.
  const realPost = `<shreddit-post data-ks-item="" class="block relative cursor-pointer group" permalink="/r/AskReddit/comments/1xsm69m/a_question/" content-href="https://www.reddit.com/r/AskReddit/comments/1xsm69m/a_question/" view-context="SubredditFeed" comment-count="0" view-type="cardView" feedindex="0" award-count="0" created-timestamp="2026-11-10T12:55:00.730000+0000" domain="self.AskReddit" id="t3_1xsm69m" post-title="A question &amp; its “quotes”" post-language="en" post-type="text" score="1" upvote-ratio="1" subreddit-id="t5_2qh1i" subreddit-prefixed-name="r/AskReddit" author-id="t2_x" author="someone" icon="https://preview.redd.it/snoovatar/avatars/abc.png" subreddit-name="AskReddit">
      <span slot="credit-bar"><img src="https://preview.redd.it/snoovatar/avatars/abc.png?width=50&amp;s=1" alt=""></span>
      <a slot="title" href="/r/AskReddit/comments/1xsm69m/a_question/">A question</a>
    </shreddit-post>
    <shreddit-ad-post id="t3_ad" created-timestamp="2026-11-10T13:00:00.000000+0000" permalink="/x"></shreddit-ad-post>`;

  it('reads the page as Reddit renders it, without avatars or ads', () => {
    expect(parseNewPage(`<html><body><shreddit-feed>${realPost}</shreddit-feed></body></html>`)).toEqual([
      {
        id: '1xsm69m',
        fullname: 't3_1xsm69m',
        title: 'A question & its “quotes”',
        subreddit: 'AskReddit',
        author: 'someone',
        created: Date.parse('2026-11-10T12:55:00.730Z'),
        score: 1,
        comments: 0,
        permalink: '/r/AskReddit/comments/1xsm69m/a_question/',
        thumbnail: undefined,
        isNsfw: false,
        isSpoiler: false,
      },
    ]);
  });

  it('skips elements that are not posts', () => {
    expect(parseNewPage('<shreddit-post id="x"></shreddit-post>')).toEqual([]);
  });
});

describe('pickSize', () => {
  const sizes = [320, 108, 640].map((width) => ({ url: String(width), width, height: width }));
  it('picks the smallest at least as wide', () => expect(pickSize(sizes, 200)?.url).toBe('320'));
  it('falls back to the largest', () => expect(pickSize(sizes, 2000)?.url).toBe('640'));
});

describe('parseSubreddit', () => {
  it('prefers the community icon, unescaped', () => {
    expect(
      parseSubreddit({ display_name: 'pics', name: 't5_2qh0u', community_icon: 'https://styles.redditmedia.com/i.png?a=1&amp;b=2', icon_img: '' }),
    ).toEqual({ name: 'pics', id: 't5_2qh0u', title: 'pics', icon: 'https://styles.redditmedia.com/i.png?a=1&b=2', isNsfw: false });
  });
});

/**
 * Reddit, as the browser's logged-in user sees it. Reddit closed its public
 * API to unregistered apps and blocks many of its JSON routes outright (403
 * "blocked by network security"), even for logged-in users. What still works,
 * as of November 2026, is read here: the JSON of the home feed, a subreddit's
 * default (hot) listing, threads, saved items and subscriptions; the web page
 * of a subreddit's newest posts; and voting, saving and subscribing.
 */

const ORIGIN = 'https://www.reddit.com';

export interface Account {
  name: string;
  avatar?: string;
}

export interface Subreddit {
  /** As Reddit spells it, e.g. "AskReddit" */
  name: string;
  /** Fullname, e.g. "t5_2qh1i" */
  id: string;
  title: string;
  icon?: string;
  isNsfw: boolean;
}

export interface Image {
  url: string;
  width: number;
  height: number;
}

/** What a post shows besides its title */
export type Media =
  | { kind: 'none' }
  | { kind: 'image'; image: Image; sizes: Image[] }
  | { kind: 'gallery'; items: { image: Image; sizes: Image[]; caption?: string }[] }
  | {
      kind: 'video';
      /** Adaptive stream with sound, which needs hls.js outside Safari */
      hls?: string;
      /** A single MP4: without sound for Reddit videos, with none to lose for GIFs */
      mp4: string;
      width: number;
      height: number;
      isGif: boolean;
    }
  /** A video or other content from another site, e.g. YouTube */
  | { kind: 'embed'; provider?: string; thumbnail?: Image };

export interface Post {
  kind: 'post';
  /** Without the t3_ prefix, as in /comments/<id> */
  id: string;
  /** e.g. t3_1abc23, which votes and saves are addressed to */
  fullname: string;
  title: string;
  subreddit: string;
  author: string;
  /** In ms since the epoch */
  created: number;
  score: number;
  comments: number;
  /** Path on reddit.com of its thread, e.g. /r/x/comments/1abc23/title/ */
  permalink: string;
  /** Where the post links to: its own thread for text posts */
  url: string;
  domain: string;
  isSelf: boolean;
  /** Sanitize before showing: it's Reddit's rendering of user Markdown. */
  selftextHtml?: string;
  /** Images the self text shows */
  selftextMedia?: InlineMedia;
  flair?: string;
  isNsfw: boolean;
  isSpoiler: boolean;
  isStickied: boolean;
  isLocked: boolean;
  isArchived: boolean;
  saved: boolean;
  /** true for an upvote, false for a downvote, null for neither */
  likes: boolean | null;
  thumbnail?: Image;
  media: Media;
  /** The post this one crossposts, which holds the media */
  crosspostFrom?: string;
}

/**
 * Images and GIFs a post's or comment's Markdown shows, by media id: Reddit's
 * HTML has only links to them. See `inlineImageFor`.
 */
export type InlineMedia = Record<string, InlineImage>;

export interface InlineImage {
  image: Image;
  /** For GIPHY GIFs, the page the HTML links to */
  link?: string;
}

export interface Comment {
  kind: 'comment';
  id: string;
  fullname: string;
  author: string;
  /** Sanitize before showing */
  bodyHtml: string;
  media?: InlineMedia;
  score: number;
  isScoreHidden: boolean;
  created: number;
  edited: number | false;
  likes: boolean | null;
  saved: boolean;
  isSubmitter: boolean;
  isStickied: boolean;
  /** "moderator" or "admin" when it speaks for them */
  distinguished?: string;
  /** Collapsed by Reddit, e.g. for a low score */
  isCollapsed: boolean;
  permalink: string;
  replies: CommentNode[];
}

/**
 * Comments a thread leaves out. With `isContinuation`, a branch too deep to
 * include ("Continue this thread"); else `count` more replies to the parent.
 */
export interface MoreComments {
  kind: 'more';
  id: string;
  /** Fullname of the comment or post they reply to */
  parentId: string;
  count: number;
  isContinuation: boolean;
}

export type CommentNode = Comment | MoreComments;

/** A comment in the Saved list, with what it was posted on */
export interface SavedComment {
  kind: 'saved-comment';
  id: string;
  fullname: string;
  author: string;
  bodyHtml: string;
  media?: InlineMedia;
  score: number;
  created: number;
  subreddit: string;
  postId: string;
  postTitle: string;
  permalink: string;
}

export interface Listing<T> {
  items: T[];
  /** Where the next page starts, if there is one */
  after?: string;
}

export interface Thread {
  post: Post;
  comments: CommentNode[];
}

export type CommentSort = 'confidence' | 'top' | 'new' | 'controversial' | 'old' | 'qa';

/** Reddit refused the request with its block page, as it does whole routes. */
export class BlockedError extends Error {
  constructor(what: string) {
    super(`Reddit blocks ${what}`);
  }
}

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in to Reddit');
  }
}

// ---- Requests ----

/**
 * Reddit's rate limits, as its responses report them. JSON requests share
 * about 100 per 10 minutes; its web pages count separately, about 600.
 */
type Bucket = 'json' | 'page';

interface BucketState {
  remaining?: number;
  /** When Reddit resets it, in ms since the epoch */
  resetAt?: number;
}

const buckets: Record<Bucket, BucketState> = { json: {}, page: {} };

/** Requests left over for what the user does next, e.g. opening a thread */
const RESERVE: Record<Bucket, number> = { json: 10, page: 20 };

/**
 * Waits until the bucket has room. Background work (`isBackground`) leaves
 * the reserve alone, so the user's own clicks still go through right away.
 */
async function waitForRoom(bucket: Bucket, isBackground: boolean) {
  const { remaining, resetAt } = buckets[bucket];
  if (remaining === undefined || resetAt === undefined) return;
  const floor = isBackground ? RESERVE[bucket] : 0;
  if (remaining > floor || Date.now() >= resetAt) return;
  rateLimitListeners.forEach((listener) => listener(bucket, resetAt));
  await new Promise((resolve) => setTimeout(resolve, resetAt - Date.now() + 1000));
}

const rateLimitListeners = new Set<(bucket: Bucket, resetAt: number) => void>();

/** Calls `listener` whenever a request waits for Reddit's rate limit to reset. */
export function onRateLimitWait(listener: (bucket: Bucket, resetAt: number) => void) {
  rateLimitListeners.add(listener);
  return () => rateLimitListeners.delete(listener);
}

function track(bucket: Bucket, res: Response) {
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!res.headers.has('x-ratelimit-remaining') || Number.isNaN(remaining)) return;
  buckets[bucket] = { remaining, resetAt: Date.now() + reset * 1000 };
}

/** Requests left in the JSON bucket and when it resets, if Reddit said */
export function jsonBudget(): BucketState {
  return { ...buckets.json };
}

async function request(
  path: string,
  init: RequestInit & { bucket: Bucket; isBackground?: boolean; what: string },
): Promise<Response> {
  const { bucket, isBackground = false, what, ...rest } = init;
  await waitForRoom(bucket, isBackground);
  const res = await fetch(ORIGIN + path, { credentials: 'include', cache: 'no-store', ...rest });
  track(bucket, res);
  if (res.status === 403 && (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new BlockedError(what);
  }
  const isAction = rest.method === 'POST';
  if (res.status === 429) {
    throw new Error(`Reddit's rate limit was reached ${isAction ? 'trying to' : 'loading'} ${what}`);
  }
  if (!res.ok) {
    if (!isAction) throw new Error(`Loading ${what} failed (${res.status})`);
    // Reddit's reason, if it gave one, for an action it refused
    const reason = await errorReason(res);
    throw new Error(`Couldn't ${what} (${res.status}${reason ? `: ${reason}` : ''})`);
  }
  return res;
}

/** The message in an error response, e.g. {"message": "Bad Request", "reason": "..."} */
async function errorReason(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { reason?: unknown; message?: unknown; explanation?: unknown };
    const parts = [body.message, body.reason, body.explanation].filter((p) => typeof p === 'string' && p);
    if (parts.length) return parts.join(', ');
  } catch {}
  // Plain text, not an HTML page
  return text && !text.trimStart().startsWith('<') ? text.trim().slice(0, 200) : undefined;
}

async function getJson<T>(
  path: string,
  params: Record<string, string | undefined>,
  what: string,
  isBackground = false,
): Promise<T> {
  const query = new URLSearchParams({ raw_json: '1' });
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  const res = await request(`${path}?${query}`, { bucket: 'json', what, isBackground });
  return res.json() as Promise<T>;
}

let modhash: string | undefined;

/**
 * Sends one of Reddit's own form actions, e.g. /api/vote. The modhash proves
 * the request comes from the logged-in user's session.
 */
async function action(path: string, params: Record<string, string>, what: string) {
  modhash ??= (await fetchMe())?.modhash;
  if (!modhash) throw new NotLoggedInError();
  const res = await request(path, {
    bucket: 'json',
    what,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Modhash': modhash },
    body: new URLSearchParams({ ...params, uh: modhash, api_type: 'json' }),
  });
  const body = (await res.json().catch(() => ({}))) as { json?: { errors?: unknown[][] } };
  const errors = body.json?.errors ?? [];
  if (errors.length) throw new Error(`Couldn't ${what}: ${errors.map((e) => e[1]).join(', ')}`);
}

// ---- Account and subscriptions ----

interface MeData {
  name?: string;
  modhash?: string;
  icon_img?: string;
  snoovatar_img?: string;
}

async function fetchMe(): Promise<{ account: Account; modhash: string } | undefined> {
  const me = await getJson<{ data?: MeData }>('/api/me.json', {}, 'your account');
  const data = me.data;
  if (!data?.name || !data.modhash) return undefined;
  return {
    account: { name: data.name, avatar: data.snoovatar_img || data.icon_img || undefined },
    modhash: data.modhash,
  };
}

/** The logged-in account, or undefined when logged out */
export async function fetchAccount(): Promise<Account | undefined> {
  const me = await fetchMe();
  modhash = me?.modhash;
  return me?.account;
}

interface Thing<T> {
  kind: string;
  data: T;
}

interface RawListing<T> {
  data?: { children?: Thing<T>[]; after?: string | null };
}

interface SubredditData {
  display_name: string;
  name: string;
  title?: string;
  community_icon?: string;
  icon_img?: string;
  over18?: boolean;
}

/** All subreddits the user is subscribed to, sorted by name */
export async function fetchSubscriptions(): Promise<Subreddit[]> {
  const subs: Subreddit[] = [];
  let after: string | undefined;
  do {
    const page = await getJson<RawListing<SubredditData>>(
      '/subreddits/mine/subscriber.json',
      { limit: '100', after },
      'your subscriptions',
    );
    for (const child of page.data?.children ?? []) subs.push(parseSubreddit(child.data));
    after = page.data?.after ?? undefined;
    // A guard against a cursor that never ends; nobody follows 5000.
  } while (after && subs.length < 5000);
  if (subs.length === 0 && !(await fetchMe())) throw new NotLoggedInError();
  return subs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function parseSubreddit(data: SubredditData): Subreddit {
  return {
    name: data.display_name,
    id: data.name,
    title: data.title ?? data.display_name,
    icon: cleanUrl(data.community_icon) || cleanUrl(data.icon_img) || undefined,
    isNsfw: data.over18 === true,
  };
}

export async function subscribe(subreddit: string, isSubscribed: boolean) {
  await action(
    '/api/subscribe',
    // skip_initial_defaults only goes with subscribing, as in other clients
    // (e.g. PRAW); an unsubscribe that had it got a 400.
    isSubscribed
      ? { action: 'sub', sr_name: subreddit, skip_initial_defaults: 'true' }
      : { action: 'unsub', sr_name: subreddit },
    isSubscribed ? `subscribe to r/${subreddit}` : `unsubscribe from r/${subreddit}`,
  );
}

// ---- Listings ----

/** The home feed ("Best"), personalized like Reddit's own */
export function fetchFeed(after?: string) {
  return fetchPosts('/best.json', after, 'your home feed');
}

/**
 * A subreddit's posts in its default order (hot). Reddit blocks every other
 * order, /r/<name>/new.json included.
 */
export function fetchSubreddit(name: string, after?: string) {
  return fetchPosts(`/r/${encodeURIComponent(name)}.json`, after, `r/${name}`);
}

async function fetchPosts(path: string, after: string | undefined, what: string) {
  const page = await getJson<RawListing<PostData>>(path, { limit: '25', after }, what);
  return parseListing(page, (thing) => (thing.kind === 't3' ? parsePost(thing.data) : undefined));
}

/** The user's saved posts and comments, latest saved first */
export async function fetchSaved(user: string, after?: string) {
  const page = await getJson<RawListing<PostData & CommentData>>(
    `/user/${encodeURIComponent(user)}/saved.json`,
    { limit: '25', after },
    'your saved items',
  );
  return parseListing<PostData & CommentData, Post | SavedComment>(page, (thing) => {
    if (thing.kind === 't3') return parsePost(thing.data);
    if (thing.kind === 't1') return parseSavedComment(thing.data);
  });
}

export function parseListing<D, T>(
  page: RawListing<D>,
  parse: (thing: Thing<D>) => T | undefined,
): Listing<T> {
  const items = (page.data?.children ?? []).flatMap((thing) => {
    const item = parse(thing);
    return item ? [item] : [];
  });
  return { items, after: page.data?.after ?? undefined };
}

// ---- Posts ----

interface ImageSource {
  url: string;
  width: number;
  height: number;
}

interface RedditVideo {
  hls_url?: string;
  fallback_url?: string;
  width?: number;
  height?: number;
  is_gif?: boolean;
}

interface PostData {
  id: string;
  name: string;
  title: string;
  subreddit: string;
  author: string;
  created_utc: number;
  score: number;
  num_comments: number;
  permalink: string;
  url?: string;
  url_overridden_by_dest?: string;
  domain?: string;
  is_self?: boolean;
  selftext_html?: string | null;
  link_flair_text?: string | null;
  over_18?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
  locked?: boolean;
  archived?: boolean;
  saved?: boolean;
  likes?: boolean | null;
  thumbnail?: string;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  post_hint?: string;
  is_video?: boolean;
  is_gallery?: boolean;
  media?: { reddit_video?: RedditVideo; oembed?: { provider_name?: string; thumbnail_url?: string; thumbnail_width?: number; thumbnail_height?: number } } | null;
  secure_media?: PostData['media'];
  preview?: {
    images?: {
      source: ImageSource;
      resolutions?: ImageSource[];
      variants?: { mp4?: { source: ImageSource } };
    }[];
    reddit_video_preview?: RedditVideo;
  };
  gallery_data?: { items?: { media_id: string; caption?: string }[] } | null;
  media_metadata?: MediaMetadata | null;
  crosspost_parent_list?: PostData[];
}

type MediaMetadata = Record<
  string,
  {
    status?: string;
    /** "Image" or "AnimatedImage" */
    e?: string;
    /** For GIPHY GIFs, the page on giphy.com */
    ext?: string;
    s?: { u?: string; gif?: string; mp4?: string; x: number; y: number };
    p?: { u: string; x: number; y: number }[];
  }
>;

/** About as wide as a comment gets */
const INLINE_WIDTH = 640;

function inlineMediaOf(metadata: MediaMetadata | null | undefined): InlineMedia | undefined {
  if (!metadata) return undefined;
  const media: InlineMedia = {};
  for (const [id, meta] of Object.entries(metadata)) {
    if (!meta.s || meta.status !== 'valid') continue;
    let image: Image | undefined;
    // An animated image's smaller sizes are stills.
    if (meta.e === 'AnimatedImage' && meta.s.gif) image = toImage({ u: meta.s.gif, x: meta.s.x, y: meta.s.y });
    else if (meta.s.u) {
      const sizes = [...(meta.p ?? []), meta.s].filter((s) => s.u).map((s) => toImage(s));
      image = pickSize(sizes, INLINE_WIDTH);
    }
    if (image) media[id] = { image, link: meta.ext ? cleanUrl(meta.ext) : undefined };
  }
  return Object.keys(media).length ? media : undefined;
}

/**
 * The image a link in Reddit's HTML stands for: Markdown images render as
 * links to preview.redd.it or i.redd.it, named by media id, and GIPHY GIFs
 * as links to their page.
 */
export function inlineImageFor(href: string, media: InlineMedia): InlineImage | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.hostname === 'preview.redd.it' || url.hostname === 'i.redd.it') {
    const id = url.pathname.slice(1).replace(/\.\w+$/, '');
    return Object.hasOwn(media, id) ? media[id] : undefined;
  }
  const giphy = url.hostname.endsWith('giphy.com') && /^\/gifs\/(?:.*-)?([^/-]+)\/?$/.exec(url.pathname)?.[1];
  return Object.entries(media).find(
    ([id, item]) => (item.link && sameUrl(item.link, url)) || (giphy && (id === `giphy|${giphy}` || id.startsWith(`giphy|${giphy}|`))),
  )?.[1];
}

function sameUrl(a: string, b: URL): boolean {
  try {
    return new URL(a).href.replace(/\/$/, '') === b.href.replace(/\/$/, '');
  } catch {
    return false;
  }
}

export function parsePost(data: PostData): Post {
  // A crosspost's media are the original's.
  const source = data.crosspost_parent_list?.[0] ?? data;
  return {
    kind: 'post',
    id: data.id,
    fullname: data.name,
    title: data.title,
    subreddit: data.subreddit,
    author: data.author,
    created: data.created_utc * 1000,
    score: data.score,
    comments: data.num_comments,
    permalink: data.permalink,
    url: data.url_overridden_by_dest ?? data.url ?? ORIGIN + data.permalink,
    domain: data.domain ?? '',
    isSelf: data.is_self === true,
    selftextHtml: data.selftext_html ?? undefined,
    selftextMedia: data.selftext_html ? inlineMediaOf(data.media_metadata) : undefined,
    flair: data.link_flair_text || undefined,
    isNsfw: data.over_18 === true,
    isSpoiler: data.spoiler === true,
    isStickied: data.stickied === true,
    isLocked: data.locked === true,
    isArchived: data.archived === true,
    saved: data.saved === true,
    likes: data.likes ?? null,
    thumbnail: thumbnailOf(source),
    media: mediaOf(source),
    crosspostFrom: source === data ? undefined : source.subreddit,
  };
}

/** Reddit's preview URLs carry signatures that break if `&` stays escaped. */
function cleanUrl(url: string | undefined): string {
  return (url ?? '').replaceAll('&amp;', '&');
}

function toImage(source: { url?: string; u?: string; width?: number; x?: number; height?: number; y?: number }): Image {
  return {
    url: cleanUrl(source.url ?? source.u),
    width: source.width ?? source.x ?? 0,
    height: source.height ?? source.y ?? 0,
  };
}

/** The smallest image at least `width` wide, else the largest there is */
export function pickSize(sizes: Image[], width: number): Image | undefined {
  const sorted = [...sizes].sort((a, b) => a.width - b.width);
  return sorted.find((s) => s.width >= width) ?? sorted.at(-1);
}

function thumbnailOf(data: PostData): Image | undefined {
  const preview = data.preview?.images?.[0];
  if (preview) {
    const sizes = [...(preview.resolutions ?? []), preview.source].map(toImage);
    return pickSize(sizes, 216);
  }
  const gallery = galleryOf(data);
  if (gallery?.[0]) return pickSize(gallery[0].sizes, 216);
  // "self", "default", "nsfw", "spoiler" and "image" stand for Reddit's own icons.
  if (data.thumbnail?.startsWith('http')) {
    return { url: cleanUrl(data.thumbnail), width: data.thumbnail_width ?? 140, height: data.thumbnail_height ?? 140 };
  }
  const embed = (data.secure_media ?? data.media)?.oembed;
  if (embed?.thumbnail_url) {
    return { url: cleanUrl(embed.thumbnail_url), width: embed.thumbnail_width ?? 0, height: embed.thumbnail_height ?? 0 };
  }
  return undefined;
}

function galleryOf(data: PostData) {
  if (!data.is_gallery || !data.gallery_data?.items || !data.media_metadata) return undefined;
  return data.gallery_data.items.flatMap((item) => {
    const meta = data.media_metadata?.[item.media_id];
    // Items still processing, or removed, have no source.
    if (!meta?.s || meta.status !== 'valid') return [];
    const full = toImage({ u: meta.s.u ?? meta.s.gif, x: meta.s.x, y: meta.s.y });
    const sizes = [...(meta.p ?? []).map((p) => toImage(p)), full];
    return [{ image: full, sizes, caption: item.caption || undefined }];
  });
}

function mediaOf(data: PostData): Media {
  const video = (data.secure_media ?? data.media)?.reddit_video;
  if (data.is_video && video?.fallback_url) return videoMedia(video);
  // GIFs and gifv links Reddit converted to video
  const gifVideo = data.preview?.reddit_video_preview;
  if (gifVideo?.fallback_url && (data.post_hint === 'link' || data.post_hint === 'image' || gifVideo.is_gif)) {
    return videoMedia({ ...gifVideo, is_gif: true });
  }
  const gallery = galleryOf(data);
  if (gallery?.length) return { kind: 'gallery', items: gallery };
  const preview = data.preview?.images?.[0];
  if (data.post_hint === 'image' && preview) {
    const mp4 = preview.variants?.mp4?.source;
    if (mp4) return { kind: 'video', mp4: cleanUrl(mp4.url), width: mp4.width, height: mp4.height, isGif: true };
    const sizes = [...(preview.resolutions ?? []), preview.source].map(toImage);
    // The linked image itself, unless it's a GIF or another site's page
    const direct = /^https:\/\/i\.redd\.it\/[^/?]+\.(jpe?g|png|webp)$/i.test(data.url ?? '');
    const image = direct ? { ...toImage(preview.source), url: data.url! } : toImage(preview.source);
    return { kind: 'image', image, sizes };
  }
  const embed = (data.secure_media ?? data.media)?.oembed;
  if (data.post_hint === 'rich:video' || embed) {
    return { kind: 'embed', provider: embed?.provider_name, thumbnail: thumbnailOf(data) };
  }
  return { kind: 'none' };
}

function videoMedia(video: RedditVideo): Media {
  return {
    kind: 'video',
    hls: video.hls_url ? cleanUrl(video.hls_url) : undefined,
    mp4: cleanUrl(video.fallback_url),
    width: video.width ?? 16,
    height: video.height ?? 9,
    isGif: video.is_gif === true,
  };
}

/** Upvotes (1), downvotes (-1) or takes back a vote (0) on a post or comment. */
export function vote(fullname: string, direction: 1 | 0 | -1) {
  return action('/api/vote', { id: fullname, dir: String(direction) }, 'vote');
}

export function save(fullname: string, isSaved: boolean) {
  return action(isSaved ? '/api/save' : '/api/unsave', { id: fullname }, isSaved ? 'save' : 'unsave');
}

/** Hides a post from the user's listings, or shows it again. */
export function hide(fullname: string, isHidden: boolean) {
  return action(isHidden ? '/api/hide' : '/api/unhide', { id: fullname }, isHidden ? 'hide' : 'unhide');
}

// ---- Threads ----

interface CommentData {
  id: string;
  name: string;
  author: string;
  body_html?: string;
  media_metadata?: MediaMetadata | null;
  score: number;
  score_hidden?: boolean;
  created_utc: number;
  edited?: number | false;
  likes?: boolean | null;
  saved?: boolean;
  is_submitter?: boolean;
  stickied?: boolean;
  distinguished?: string | null;
  collapsed?: boolean;
  permalink: string;
  replies?: RawListing<CommentData & MoreData> | '';
  // For saved comments
  subreddit?: string;
  link_id?: string;
  link_title?: string;
}

interface MoreData {
  id: string;
  parent_id: string;
  count: number;
  children?: string[];
}

/**
 * A post and up to `limit` of its comments, at most about 500, as many as
 * Reddit sends in one request: the route that loads the rest
 * (/api/morechildren) is blocked. The more comments, the longer Reddit takes:
 * 500 from a busy thread can take seconds.
 */
export async function fetchThread(postId: string, sort?: CommentSort, limit = 500): Promise<Thread> {
  const [postPage, commentPage] = await getJson<[RawListing<PostData>, RawListing<CommentData & MoreData>]>(
    `/comments/${encodeURIComponent(postId)}.json`,
    { limit: String(limit), sort },
    'this thread',
  );
  return { post: postOf(postPage), comments: parseComments(commentPage) };
}

/**
 * A post and one of its comments, with as many of its replies as Reddit
 * sends, for permalinks, "Continue this thread" and replies a thread left out.
 */
export async function fetchCommentThread(postId: string, commentId: string, sort?: CommentSort): Promise<Thread> {
  const [postPage, commentPage] = await getJson<[RawListing<PostData>, RawListing<CommentData & MoreData>]>(
    `/comments/${encodeURIComponent(postId)}/_/${encodeURIComponent(commentId)}.json`,
    { limit: '500', sort },
    'these replies',
  );
  const comment = parseComments(commentPage)[0];
  if (comment?.kind !== 'comment') throw new Error('Reddit sent no comment');
  return { post: postOf(postPage), comments: [comment] };
}

/** A comment with as many of its replies as Reddit sends */
export async function fetchCommentTree(postId: string, commentId: string, sort?: CommentSort): Promise<Comment> {
  return (await fetchCommentThread(postId, commentId, sort)).comments[0] as Comment;
}

function postOf(page: RawListing<PostData>): Post {
  const post = page.data?.children?.[0];
  if (post?.kind !== 't3') throw new Error('Reddit sent no post for this thread');
  return parsePost(post.data);
}

/** Whether a thread left out comments that a request for more would include */
export function leavesOutComments(nodes: CommentNode[]): boolean {
  // "Continue this thread" is for depth, which no limit changes.
  return nodes.some((node) => (node.kind === 'more' ? !node.isContinuation : leavesOutComments(node.replies)));
}

export function parseComments(listing: RawListing<CommentData & MoreData> | '' | undefined): CommentNode[] {
  if (!listing) return [];
  return (listing.data?.children ?? []).flatMap((thing): CommentNode[] => {
    if (thing.kind === 'more') {
      const more = thing.data;
      // "Continue this thread" has id "_" and no children; an empty "more"
      // with nothing to load says nothing.
      const isContinuation = more.id === '_' || (more.count === 0 && !more.children?.length);
      if (!isContinuation && more.count === 0) return [];
      return [{ kind: 'more', id: more.id, parentId: more.parent_id, count: more.count, isContinuation }];
    }
    if (thing.kind !== 't1') return [];
    const c = thing.data;
    return [
      {
        kind: 'comment',
        id: c.id,
        fullname: c.name,
        author: c.author,
        bodyHtml: c.body_html ?? '',
        media: inlineMediaOf(c.media_metadata),
        score: c.score,
        isScoreHidden: c.score_hidden === true,
        created: c.created_utc * 1000,
        edited: typeof c.edited === 'number' ? c.edited * 1000 : false,
        likes: c.likes ?? null,
        saved: c.saved === true,
        isSubmitter: c.is_submitter === true,
        isStickied: c.stickied === true,
        distinguished: c.distinguished ?? undefined,
        isCollapsed: c.collapsed === true,
        permalink: c.permalink,
        replies: parseComments(c.replies),
      },
    ];
  });
}

function parseSavedComment(c: CommentData): SavedComment {
  return {
    kind: 'saved-comment',
    id: c.id,
    fullname: c.name,
    author: c.author,
    bodyHtml: c.body_html ?? '',
    media: inlineMediaOf(c.media_metadata),
    score: c.score,
    created: c.created_utc * 1000,
    subreddit: c.subreddit ?? '',
    postId: (c.link_id ?? '').replace(/^t3_/, ''),
    postTitle: c.link_title ?? '',
    permalink: c.permalink,
  };
}

// ---- A subreddit's newest posts, from its web page ----

/** A post as a subreddit's "new" page lists it */
export interface NewPost {
  id: string;
  fullname: string;
  title: string;
  subreddit: string;
  author?: string;
  created: number;
  score?: number;
  comments?: number;
  permalink: string;
  thumbnail?: string;
  isNsfw: boolean;
  isSpoiler: boolean;
}

/**
 * The newest posts of a subreddit, newest first, read from its "new" web page:
 * Reddit blocks /r/<name>/new.json, but not the page, whose requests also
 * count against the larger rate limit. The page holds only the first few.
 */
export async function fetchNewPosts(subreddit: string, isBackground = true): Promise<NewPost[]> {
  const res = await request(`/r/${encodeURIComponent(subreddit)}/new/`, {
    bucket: 'page',
    what: `r/${subreddit}`,
    isBackground,
  });
  // A subreddit that's gone, private or renamed sends the user elsewhere.
  if (res.redirected && !new URL(res.url).pathname.toLowerCase().startsWith(`/r/${subreddit.toLowerCase()}`)) {
    return [];
  }
  return parseNewPage(await res.text());
}

/** The posts in the HTML of a subreddit's "new" page, as Reddit's web client renders them */
export function parseNewPage(html: string): NewPost[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const posts = [...doc.querySelectorAll('shreddit-post')].flatMap((el): NewPost[] => {
    const attr = (name: string) => el.getAttribute(name) ?? undefined;
    const fullname = attr('id') ?? attr('thingid');
    const created = Date.parse(attr('created-timestamp') ?? '');
    const permalink = attr('permalink');
    if (!fullname?.startsWith('t3_') || Number.isNaN(created) || !permalink) return [];
    const number = (name: string) => {
      const value = Number(attr(name));
      return attr(name) !== undefined && Number.isFinite(value) ? value : undefined;
    };
    // The post's own image, not its author's avatar in the credit bar, which
    // can come from the same image host.
    const thumbnail = [...el.querySelectorAll('img')].find((img) => {
      const src = img.getAttribute('src') ?? '';
      return (
        !img.closest('[slot="credit-bar"]') &&
        !src.includes('/snoovatar/') &&
        /^https:\/\/(preview|external-preview|i|b\.thumbs)\.redd(it)?\.(it|com)\//.test(src)
      );
    });
    return [
      {
        id: fullname.slice(3),
        fullname,
        title: attr('post-title') ?? '',
        subreddit: (attr('subreddit-prefixed-name') ?? attr('subreddit-name') ?? '').replace(/^r\//, ''),
        author: attr('author'),
        created,
        score: number('score'),
        comments: number('comment-count'),
        permalink,
        thumbnail: thumbnail ? cleanUrl(thumbnail.getAttribute('src') ?? undefined) : undefined,
        isNsfw: el.hasAttribute('nsfw'),
        isSpoiler: el.hasAttribute('spoiler'),
      },
    ];
  });
  // Pinned posts come first on the page whatever their age.
  return posts.sort((a, b) => b.created - a.created);
}

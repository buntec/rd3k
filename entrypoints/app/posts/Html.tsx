import { memo, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { routeForRedditUrl, routeHref } from '../router';
import { inlineImageFor, type InlineMedia } from '@/utils/reddit';

const purify = DOMPurify();

// Reddit's Markdown links to its own pages with paths, e.g. /r/x or /u/y,
// which on this page would point into the extension. Make them absolute, and
// open every link outside rd3k in a new tab.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  const href = node.getAttribute('href');
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href, 'https://www.reddit.com');
  } catch {
    node.removeAttribute('href');
    return;
  }
  const route = routeForRedditUrl(url.href);
  if (route) {
    node.setAttribute('href', routeHref(route));
    node.removeAttribute('target');
    return;
  }
  node.setAttribute('href', url.href);
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

/**
 * Reddit's rendering of a post's or comment's Markdown, sanitized: it's user
 * content. Links to subreddits and threads open in rd3k, and links to the
 * images in `media` show them, opening the image in a new tab when clicked.
 */
export const Html = memo(function Html({ html, media }: { html: string; media?: InlineMedia }) {
  const clean = useMemo(() => {
    const fragment = purify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button'],
      ADD_ATTR: ['target'],
      RETURN_DOM_FRAGMENT: true,
    });
    if (media) showImages(fragment, media);
    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
  }, [html, media]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: clean }} />;
});

function showImages(root: DocumentFragment, media: InlineMedia) {
  for (const link of root.querySelectorAll('a[href]')) {
    const item = inlineImageFor(link.getAttribute('href')!, media);
    if (!item) continue;
    const img = document.createElement('img');
    img.src = item.image.url;
    if (item.image.width && item.image.height) {
      img.width = item.image.width;
      img.height = item.image.height;
    }
    img.alt = '';
    img.loading = 'lazy';
    link.replaceChildren(img);
    link.classList.add('md-image');
  }
}

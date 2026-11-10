import { memo, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { routeForRedditUrl, routeHref } from '../router';

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
 * content. Links to subreddits and threads open in rd3k.
 */
export const Html = memo(function Html({ html }: { html: string }) {
  const clean = useMemo(
    () => purify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button'], ADD_ATTR: ['target'] }),
    [html],
  );
  return <div className="md" dangerouslySetInnerHTML={{ __html: clean }} />;
});

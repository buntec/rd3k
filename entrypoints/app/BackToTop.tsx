import { type RefObject, useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';

/**
 * A button floating at the bottom right that scrolls `scrollRef` back to its
 * top, shown once that's scrolled down more than its own height.
 */
export function BackToTop({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const isShown = useIsScrolledDown(scrollRef, (element) => element.clientHeight);
  if (!isShown) return null;
  return (
    <IconButton
      className="back-to-top"
      label="Back to top"
      tooltip="Back to top"
      icon={<Icon icon={ArrowUp} />}
      size="lg"
      elevation="med"
      onClick={() => {
        const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollRef.current?.scrollTo({ top: 0, behavior: isReduced ? 'instant' : 'smooth' });
      }}
    />
  );
}

/**
 * Whether the element is scrolled down at least `distance` pixels, which a
 * function works out on each scroll, e.g. from the element's height. The
 * `distance` of the first render is the one used.
 */
export function useIsScrolledDown(
  ref: RefObject<HTMLElement | null>,
  distance: number | ((element: HTMLElement) => number),
) {
  const [isDown, setIsDown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () =>
      setIsDown(element.scrollTop >= (typeof distance === 'number' ? distance : distance(element)));
    check();
    element.addEventListener('scroll', check, { passive: true });
    return () => element.removeEventListener('scroll', check);
  }, [ref]);
  return isDown;
}

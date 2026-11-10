// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';

// The router keeps its record from the page's load on, so each case carries
// on from where the one before left off.
let router: typeof import('./router');

beforeAll(async () => {
  history.replaceState(null, '', '#/feed');
  router = await import('./router');
  router.getAppLocation();
});

async function settle(navigate: () => void) {
  const changed = new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
  navigate();
  await changed;
}

const at = (hash: string) => settle(() => (location.hash = hash));

describe('a thread', () => {
  it('opens over the page it came from', async () => {
    await at('#/comments/a1');
    expect(router.getAppLocation()).toMatchObject({
      route: { page: 'thread', postId: 'a1', commentId: undefined },
      page: { page: 'feed' },
    });
  });

  it('keeps that page behind the threads it links to', async () => {
    await at('#/comments/b2');
    await at('#/comments/b2/c3');
    expect(router.getAppLocation().page).toEqual({ page: 'feed' });
  });

  it('closes back to that page in one step', async () => {
    await settle(router.closeThread);
    expect(location.hash).toBe('#/feed');
    expect(router.getAppLocation().route).toEqual({ page: 'feed' });
  });

  it('still knows that page after going forward to it again', async () => {
    await settle(() => history.forward());
    expect(router.getAppLocation()).toMatchObject({
      route: { page: 'thread', postId: 'a1', commentId: undefined },
      page: { page: 'feed' },
    });
  });

  it('opens from another page over that one', async () => {
    await at('#/saved');
    await at('#/comments/d4');
    expect(router.getAppLocation().page).toEqual({ page: 'saved' });
    await settle(router.closeThread);
    expect(location.hash).toBe('#/saved');
  });
});

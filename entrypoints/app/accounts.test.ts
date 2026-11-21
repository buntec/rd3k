// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Account, NewPost, Subreddit } from '@/utils/reddit';

// Reddit as the browser's cookies have it: which account, and what it sends.
const reddit = vi.hoisted(() => ({
  fetchAccount: vi.fn<() => Promise<Account | undefined>>(),
  fetchSubscriptions: vi.fn<(signal?: AbortSignal) => Promise<Subreddit[]>>(),
  fetchNewPosts: vi.fn<(name: string, options?: { signal?: AbortSignal }) => Promise<NewPost[]>>(),
  subscribe: vi.fn<(name: string, isSubscribed: boolean) => Promise<void>>(),
}));

vi.mock('@/utils/reddit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/reddit')>()),
  ...reddit,
}));

const alice = { name: 'Alice' };
const bob = { name: 'Bob' };
const sub = (name: string): Subreddit => ({ name, id: `t5_${name}`, title: name, isNsfw: false });
const group = (name: string) => ({ id: name, name, color: 'blue' as const, subreddits: [name.toLowerCase()] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A fresh page: the modules' state is per page, storage is shared. */
async function openPage() {
  vi.resetModules();
  return {
    account: await import('./account'),
    store: await import('./subscriptions/store'),
    groups: await import('./subscriptions/groups'),
    storage: await import('./accountStorage'),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  localStorage.clear();
  vi.resetAllMocks();
  reddit.fetchNewPosts.mockResolvedValue([]);
  // Web Locks, which jsdom lacks: one holder at a time per name
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (name: string, fn: () => Promise<unknown>) => {
        const result = (queues.get(name) ?? Promise.resolve()).then(fn);
        queues.set(name, result.catch(() => {}));
        return result;
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscriptions', () => {
  it("aren't stored for the account last seen when Reddit is logged in as another", async () => {
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(bob);
    reddit.fetchSubscriptions.mockResolvedValue([sub('bobs')]);
    const { store } = await openPage();

    await store.loadSubscriptions();

    await vi.waitFor(async () => expect(await storage.getItem('local:subscriptions:bob')).toEqual([sub('bobs')]));
    expect(await storage.getItem('local:subscriptions:alice')).toBeNull();
  });

  it("aren't stored for the account shown when it switched while they loaded", async () => {
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(alice);
    const loading = deferred<Subreddit[]>();
    reddit.fetchSubscriptions.mockReturnValueOnce(loading.promise).mockResolvedValue([sub('bobs')]);
    const { store } = await openPage();

    await store.loadSubscriptions();
    await vi.waitFor(() => expect(reddit.fetchSubscriptions).toHaveBeenCalled());
    // Switched on reddit.com: the list on its way is Bob's.
    reddit.fetchAccount.mockResolvedValue(bob);
    loading.resolve([sub('bobs')]);

    await vi.waitFor(async () => expect(await storage.getItem('local:subscriptions:bob')).toEqual([sub('bobs')]));
    expect(await storage.getItem('local:subscriptions:alice')).toBeNull();
  });

  it('stop loading feeds on a switch, waiting ones included, and store none of them', async () => {
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(alice);
    reddit.fetchSubscriptions.mockResolvedValue([sub('pics')]);
    const sent = deferred<NewPost[]>();
    let signal: AbortSignal | undefined;
    reddit.fetchNewPosts.mockImplementation((_name, options) => {
      signal = options?.signal;
      // Waiting for the rate limit, then sent as whoever is logged in by then
      return sent.promise;
    });
    const { account, store } = await openPage();

    await store.loadSubscriptions();
    await vi.waitFor(() => expect(signal).toBeDefined());
    reddit.fetchAccount.mockResolvedValue(bob);
    reddit.fetchSubscriptions.mockResolvedValue([]);
    await account.confirmAccount();

    expect(signal!.aborted).toBe(true);
    // Even if it went through anyway
    sent.resolve([{ fullname: 't3_x' } as NewPost]);
    await new Promise((r) => setTimeout(r, 700));
    expect(await storage.getItem('local:feeds:alice')).toBeNull();
  });
});

describe('subscriptions, continued', () => {
  it('store no feeds before Reddit confirms the account again, while they load', async () => {
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(alice);
    reddit.fetchSubscriptions.mockResolvedValue([sub('pics'), sub('cats')]);
    const cats = deferred<NewPost[]>();
    reddit.fetchNewPosts.mockImplementation((name) => (name === 'cats' ? cats.promise : Promise.resolve([])));
    const { store } = await openPage();

    await store.loadSubscriptions();
    await vi.waitFor(() => expect(store.isSubscribed('pics')).toBe(true));
    await new Promise((r) => setTimeout(r, 700));
    expect(await storage.getItem('local:feeds:alice')).toBeNull();

    cats.resolve([]);
    await vi.waitFor(async () => expect(await storage.getItem('local:feeds:alice')).not.toBeNull());
  });

  it("don't (un)subscribe, nor store it, when Reddit is logged in as another account now", async () => {
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(alice);
    reddit.fetchSubscriptions.mockResolvedValue([sub('pics')]);
    const { store } = await openPage();
    await store.loadSubscriptions();
    await vi.waitFor(async () => expect(await storage.getItem('local:subscriptions:alice')).toEqual([sub('pics')]));

    reddit.fetchAccount.mockResolvedValue(bob);
    await expect(store.setSubscription('pics', false)).rejects.toThrow('account changed');
    expect(reddit.subscribe).not.toHaveBeenCalled();
    expect(await storage.getItem('local:subscriptions:alice')).toEqual([sub('pics')]);
  });

  it("show an error, not logged out, when Reddit can't be asked on a first visit", async () => {
    await storage.setItem('local:subscriptions:alice', [sub('pics')]);
    reddit.fetchAccount.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(alice);
    reddit.fetchSubscriptions.mockResolvedValue([sub('pics')]);
    const { account, store } = await openPage();

    const shown = await store.loadSubscriptions();
    expect(shown.status).toEqual({ text: "Couldn't reach Reddit: offline", isError: true });

    // Coming back to the tab
    await account.confirmAccount();
    await vi.waitFor(() => expect(store.isSubscribed('pics')).toBe(true));
  });
});

describe('the account', () => {
  it('is checked once for any number of views, until coming back to the page', async () => {
    reddit.fetchAccount.mockResolvedValue(alice);
    const { account } = await openPage();
    await account.loadAccount();
    for (let i = 0; i < 5; i++) account.watchAccount(() => {})();
    expect(reddit.fetchAccount).toHaveBeenCalledTimes(1);

    // Earlier tests' pages listen on the same window too, so only "again" is certain.
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(reddit.fetchAccount.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('groups', () => {
  it("can't be changed until Reddit confirms the account they're of", async () => {
    localStorage.setItem('account', 'Alice');
    await storage.setItem('local:groups:alice', { groups: [group('Tech')] });
    const confirming = deferred<Account>();
    reddit.fetchAccount.mockReturnValue(confirming.promise);
    const { groups } = await openPage();

    const before = await groups.loadGroups();
    expect(before.groups.map((g) => g.name)).toEqual(['Tech']);
    expect(before.isEditable).toBe(false);
    expect(groups.createGroup(before.session, 'News', 'red')).toBe(false);

    confirming.resolve(alice);
    await vi.waitFor(() => expect(groups.groupsNow().isEditable).toBe(true));
    expect(groups.createGroup(before.session, 'News', 'red')).toBe(true);
    await vi.waitFor(async () => {
      const stored = await storage.getItem<{ groups: { name: string }[] }>('local:groups:alice');
      expect(stored?.groups.map((g) => g.name)).toEqual(['News', 'Tech']);
    });
  });

  it("an Undo started with one account doesn't change another's", async () => {
    await storage.setItem('local:groups:alice', { groups: [group('Tech')] });
    await storage.setItem('local:groups:bob', { groups: [group('Cats')] });
    reddit.fetchAccount.mockResolvedValue(alice);
    const { account, groups } = await openPage();
    await account.loadAccount();
    const { session, groups: before } = await groups.loadGroups();
    await vi.waitFor(() => expect(groups.groupsNow().isEditable).toBe(true));
    const onEnd = vi.fn();
    groups.onSessionEnd(session, onEnd);

    reddit.fetchAccount.mockResolvedValue(bob);
    await account.confirmAccount();
    await vi.waitFor(() => expect(groups.groupsNow().groups.map((g) => g.name)).toEqual(['Cats']));

    expect(onEnd).toHaveBeenCalled();
    expect(groups.setGroups(session, before)).toBe(false);
    expect(groups.deleteGroup(session, 'Cats')).toBe(false);
    const stored = await storage.getItem<{ groups: { name: string }[] }>('local:groups:bob');
    expect(stored?.groups.map((g) => g.name)).toEqual(['Cats']);
  });
});

describe('data stored before accounts were kept apart', () => {
  it('all goes to the first account Reddit confirms, whichever store opens first', async () => {
    await storage.setItem('local:groups', { groups: [group('Tech')] });
    await storage.setItem('local:subscriptions', [sub('pics')]);
    localStorage.setItem('groupFilter', 'Tech');
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(bob);
    reddit.fetchSubscriptions.mockResolvedValue([sub('pics')]);
    const { store, groups } = await openPage();

    await store.loadSubscriptions();
    await vi.waitFor(async () => expect(await storage.getItem('local:groups')).toBeNull());
    reddit.fetchAccount.mockResolvedValue(alice);
    await groups.loadGroups();

    expect(await storage.getItem('local:unkeyedOwner')).toBe('bob');
    expect(await storage.getItem('local:groups:bob')).toEqual({ groups: [group('Tech')] });
    expect(await storage.getItem('local:groups:alice')).toBeNull();
    expect(localStorage.getItem('groupFilter:bob')).toBe('Tech');
    expect(localStorage.getItem('groupFilter')).toBeNull();
  });

  it('goes to one account when two pages move it at once', async () => {
    await storage.setItem('local:groups', { groups: [group('Tech')] });
    const first = deferred<Account>();
    reddit.fetchAccount.mockReturnValueOnce(first.promise);
    const one = await openPage();
    const movingOne = one.storage.moveUnkeyedData();
    reddit.fetchAccount.mockResolvedValue(bob);
    const two = await openPage();
    const movingTwo = two.storage.moveUnkeyedData();
    first.resolve(alice);
    await Promise.all([movingOne, movingTwo]);

    expect(await storage.getItem('local:groups:alice')).toEqual({ groups: [group('Tech')] });
    expect(await storage.getItem('local:groups:bob')).toBeNull();
    expect(await storage.getItem('local:groups')).toBeNull();
  });

  it("isn't lost when moving it fails at first: no groups are stored for the account till it's moved", async () => {
    await storage.setItem('local:groups', { groups: [group('Tech')] });
    localStorage.setItem('account', 'Alice');
    reddit.fetchAccount.mockResolvedValue(alice);
    // Moving fails once, e.g. on a storage error, with the account confirmed
    const locks = navigator.locks;
    let fails = 1;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (name: string, fn: () => Promise<unknown>) =>
          fails-- > 0 ? Promise.reject(new Error('lock failed')) : locks.request(name, fn),
      },
    });
    const { account, groups } = await openPage();

    void groups.loadGroups();
    await account.loadAccount();
    await vi.waitFor(() => expect(fails).toBeLessThan(1));
    await new Promise((r) => setTimeout(r, 50));
    // Stored now, a group would have the move skip the old ones, then drop them.
    expect(groups.groupsNow().isLoaded).toBe(false);
    expect(groups.createGroup(groups.groupsNow().session, 'News', 'red')).toBe(false);

    // Coming back to the tab tries again.
    await account.confirmAccount();
    await vi.waitFor(() => expect(groups.groupsNow().groups.map((g) => g.name)).toEqual(['Tech']));
    expect(await storage.getItem('local:groups')).toBeNull();
  });

  it('stays while logged out, for the next account to get', async () => {
    await storage.setItem('local:groups', { groups: [group('Tech')] });
    reddit.fetchAccount.mockResolvedValue(undefined);
    const { storage: moving } = await openPage();
    await moving.moveUnkeyedData();
    expect(await storage.getItem('local:groups')).not.toBeNull();

    reddit.fetchAccount.mockResolvedValue(alice);
    await moving.moveUnkeyedData();
    expect(await storage.getItem('local:groups:alice')).toEqual({ groups: [group('Tech')] });
  });
});

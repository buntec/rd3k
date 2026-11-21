import { accountKey, confirmAccount, watchAccount } from './account';

type LocalKey = `local:${string}`;

/** Where an account's copy of what's stored under `base` goes, e.g. local:groups:spez */
export function keyFor(base: LocalKey, account: string): LocalKey {
  return `${base}:${accountKey(account)}`;
}

// What rd3k stored before it kept data per account, in extension storage and
// in localStorage. It all goes to one account, the owner.
const UNKEYED: LocalKey[] = ['local:subscriptions', 'local:feeds', 'local:groups'];
const UNKEYED_LOCAL = ['groupFilter'];
/**
 * The owner: the first account Reddit confirmed once there was data to move,
 * kept so every page, and every retry after a failure, moves it to the same one.
 */
const OWNER_KEY: LocalKey = 'local:unkeyedOwner';
const LOCK = 'rd3k-unkeyed-data';

let moving: Promise<boolean> | undefined;

/**
 * Moves what was stored before rd3k kept data per account to the account
 * that was logged in then, as far as anyone can tell: the first one Reddit
 * confirms. Resolves whether it's done, i.e. nothing is left to move. While
 * logged out, or if it fails, it's left for the next call to try.
 */
export function moveUnkeyedData(): Promise<boolean> {
  moving ??= move()
    .catch((err: unknown) => {
      console.warn(err);
      return false;
    })
    .then((isDone) => {
      if (!isDone) moving = undefined;
      return isDone;
    });
  return moving;
}

/**
 * Waits until moveUnkeyedData() is done, trying again whenever Reddit answers
 * an account check, e.g. on coming back to the tab. Stores wait for it before
 * opening an account's data: changes stored before would make the move skip
 * the old data, then drop it. `onWaiting` is called on failing. Resolves false
 * once `isWanted()` says the data isn't wanted any more, e.g. after a switch.
 */
export async function untilMoved(isWanted: () => boolean, onWaiting?: () => void): Promise<boolean> {
  while (isWanted()) {
    if (await moveUnkeyedData()) return isWanted();
    if (!isWanted()) return false;
    onWaiting?.();
    await new Promise<void>((resolve) => {
      const stop = watchAccount(() => {
        stop();
        resolve();
      });
    });
  }
  return false;
}

/** Whether there's nothing left to move */
async function move(): Promise<boolean> {
  if (!(await hasUnkeyed())) return true;
  // One page at a time, so two never pick different owners or both copy.
  return navigator.locks.request(LOCK, async () => {
    if (!(await hasUnkeyed())) return true;
    let owner = await storage.getItem<string>(OWNER_KEY);
    if (!owner) {
      const account = await confirmAccount();
      if (!account) return false;
      owner = accountKey(account.name);
      await storage.setItem(OWNER_KEY, owner);
    }
    for (const base of UNKEYED) await moveItem(base, owner);
    for (const base of UNKEYED_LOCAL) moveLocal(base, owner);
    return true;
  });
}

async function hasUnkeyed(): Promise<boolean> {
  const values = await storage.getItems(UNKEYED);
  return values.some((v) => v.value !== null) || UNKEYED_LOCAL.some((key) => localStorage.getItem(key) !== null);
}

async function moveItem(base: LocalKey, owner: string) {
  const value = await storage.getItem(base);
  if (value === null) return;
  const key = keyFor(base, owner);
  // Already there if an earlier try copied it but failed to remove it here.
  if ((await storage.getItem(key)) === null) {
    const meta = await storage.getMeta(base);
    if (Object.keys(meta).length) await storage.setMeta(key, meta);
    await storage.setItem(key, value);
    // The groups may be the only copy of real work: keep it until it's safe.
    if (JSON.stringify(await storage.getItem(key)) !== JSON.stringify(value)) {
      throw new Error(`Couldn't move ${base} to ${key}`);
    }
  }
  await storage.removeItem(base, { removeMeta: true });
}

function moveLocal(base: string, owner: string) {
  const value = localStorage.getItem(base);
  if (value === null) return;
  const key = `${base}:${accountKey(owner)}`;
  if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  localStorage.removeItem(base);
}

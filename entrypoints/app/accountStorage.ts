import { accountKey } from './account';

type LocalKey = `local:${string}`;

/** Where an account's copy of what's stored under `base` goes, e.g. local:groups:spez */
export function keyFor(base: LocalKey, account: string): LocalKey {
  return `${base}:${accountKey(account)}`;
}

/**
 * Gives `account` what's stored under `base` from before rd3k kept data per
 * account, unless it has its own already, and removes it there: it belonged
 * to whichever account was logged in then, most likely the first one seen.
 */
export async function adoptUnkeyed(base: LocalKey, account: string) {
  const unkeyed = await storage.getItem(base);
  if (unkeyed === null) return;
  const key = keyFor(base, account);
  // Another tab may have adopted it meanwhile.
  if ((await storage.getItem(key)) === null) {
    await storage.setItem(key, unkeyed);
    const meta = await storage.getMeta(base);
    if (Object.keys(meta).length) await storage.setMeta(key, meta);
  }
  await storage.removeItem(base, { removeMeta: true });
}

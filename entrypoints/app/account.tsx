import { useSyncExternalStore } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { type Account, fetchAccount } from '@/utils/reddit';

const LOGIN_URL = 'https://www.reddit.com/login/';

// The account Reddit last confirmed: undefined until a check succeeds, null
// when logged out. Reddit acts as whichever account the browser's cookies
// are of, which changes on reddit.com without telling rd3k, so anything that
// stores what Reddit sent checks it with confirmAccount() first.
let account: Account | null | undefined;
const listeners = new Set<() => void>();
let started = false;
/** A check started on coming back to the page, which others join */
let loading: Promise<void> | undefined;
/** Checks started, and the latest of them whose answer was taken */
let checks = 0;
let applied = 0;

// The account's name as last confirmed, kept across visits in localStorage
// so the data stored for it can show before Reddit confirms it again. It's
// only a hint: nothing is stored for it until Reddit confirms it. Losing it
// only means waiting for Reddit.
const NAME_KEY = 'account';
let name: string | null | undefined = storedName();
/** Counts switches from one known account to another */
let generation = 0;
const changeListeners = new Set<(name: string | null, previous: string | null | undefined) => void>();

/** The Reddit account the app acts as, or a link to log in. */
export function AccountStatus() {
  const current = useAccount();
  if (current === undefined) return null;
  if (current === null) {
    return <Button label="Log in to Reddit" size="sm" href={LOGIN_URL} target="_blank" />;
  }
  return (
    <Avatar
      src={current.avatar}
      name={current.name}
      size="sm"
      href={`https://www.reddit.com/user/${current.name}/`}
      target="_blank"
      tooltip={`Logged in to Reddit as u/${current.name}`}
    />
  );
}

/** The logged-in account: undefined until known, null when logged out */
export function useAccount(): Account | null | undefined {
  return useSyncExternalStore(watchAccount, () => account);
}

/** The logged-in account, once known; null too if Reddit couldn't be asked */
export async function loadAccount(): Promise<Account | null> {
  if (account !== undefined) return account;
  start();
  loading ??= load();
  await loading;
  return account ?? null;
}

/**
 * Asks Reddit which account the browser is logged in as now, even if a check
 * is under way, which may have started before a switch. Throws if Reddit
 * couldn't be asked.
 */
export function confirmAccount(): Promise<Account | null> {
  start();
  return check();
}

/** The account Reddit last confirmed: undefined until it has, null when logged out */
export function confirmedAccount(): Account | null | undefined {
  return account;
}

/**
 * The name of the account last confirmed, on this visit or an earlier one:
 * undefined if none, null if logged out. Reddit may yet say it changed.
 */
export function accountName(): string | null | undefined {
  return name;
}

/**
 * Calls `listener` whenever Reddit confirms an account other than
 * accountName() was: on logging in or out, switching accounts on reddit.com,
 * or a first confirmation. `previous` is undefined if no account was known.
 */
export function onAccountChange(listener: (name: string | null, previous: string | null | undefined) => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Counts the switches from one known account to another, so what was loaded
 * for an earlier one can tell it's out of date. A first confirmation doesn't
 * count: what loaded before it was loaded as that account anyway.
 */
export function useAccountGeneration(): number {
  return useSyncExternalStore(watchAccount, () => generation);
}

/** Calls `onChange` whenever Reddit answers a check, whether or not the account changed. */
export function watchAccount(onChange: () => void) {
  start();
  loading ??= load();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** An account's name as storage keys hold it: Reddit's ignore case. */
export function accountKey(name: string): string {
  return name.toLowerCase();
}

/** The key of the account named, or null when logged out */
export function keyOf(name: string | null | undefined): string | null {
  return name ? accountKey(name) : null;
}

function start() {
  if (started) return;
  started = true;
  // Logging in or out, or switching accounts, happens on reddit.com, in
  // another browser tab or window.
  const check = () => {
    if (document.visibilityState === 'visible') loading ??= load();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
}

function load(): Promise<void> {
  return check()
    .then(
      () => {},
      // Keep showing what was known before.
      (err: unknown) => console.warn(err),
    )
    .finally(() => {
      loading = undefined;
    });
}

async function check(): Promise<Account | null> {
  const seq = ++checks;
  const result = (await fetchAccount()) ?? null;
  // A later check answered first: its answer is the newer one.
  if (seq > applied) {
    applied = seq;
    apply(result);
  }
  return result;
}

function apply(next: Account | null) {
  account = next;
  const nextName = next?.name ?? null;
  if (keyOf(nextName) !== keyOf(name)) {
    const previous = name;
    name = nextName;
    storeName(nextName);
    if (previous !== undefined) generation++;
    for (const listener of changeListeners) listener(nextName, previous);
  }
  for (const listener of listeners) listener();
}

function storedName(): string | undefined {
  try {
    return localStorage.getItem(NAME_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeName(value: string | null) {
  try {
    // Logged out is only worth knowing on this visit.
    if (value) localStorage.setItem(NAME_KEY, value);
    else localStorage.removeItem(NAME_KEY);
  } catch (err) {
    console.warn(err);
  }
}

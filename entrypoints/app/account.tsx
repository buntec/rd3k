import { useSyncExternalStore } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { type Account, fetchAccount } from '@/utils/reddit';

const LOGIN_URL = 'https://www.reddit.com/login/';

// Undefined until known, null when logged out.
let account: Account | null | undefined;
const listeners = new Set<() => void>();
let started = false;
let loading: Promise<void> | undefined;

// The account's name as last confirmed, kept across visits in localStorage
// so the data stored for it can show before Reddit confirms it again. Losing
// it only means waiting for Reddit.
const NAME_KEY = 'account';
let name: string | null | undefined = storedName();
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
  return useSyncExternalStore(subscribe, () => account);
}

/** The logged-in account, once known */
export async function loadAccount(): Promise<Account | null> {
  if (account !== undefined) return account;
  start();
  loading ??= load();
  await loading;
  return account ?? null;
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

/** An account's name as storage keys hold it: Reddit's ignore case. */
export function accountKey(name: string): string {
  return name.toLowerCase();
}

function subscribe(onChange: () => void) {
  start();
  loading ??= load();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
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

async function load() {
  try {
    account = (await fetchAccount()) ?? null;
  } catch (err) {
    // Keep showing what was known before.
    console.warn(err);
    return;
  } finally {
    loading = undefined;
  }
  const next = account?.name ?? null;
  if ((next && accountKey(next)) !== (name && accountKey(name))) {
    const previous = name;
    name = next;
    storeName(next);
    for (const listener of changeListeners) listener(next, previous);
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

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
  loading ??= load();
  await loading;
  return account ?? null;
}

function subscribe(onChange: () => void) {
  if (!started) {
    started = true;
    loading ??= load();
    // Logging in or out happens on reddit.com, in another browser tab.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void load();
    });
  }
  listeners.add(onChange);
  return () => listeners.delete(onChange);
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
  for (const listener of listeners) listener();
}

import { useMemo, useSyncExternalStore } from 'react';
import { accountName, confirmedAccount, keyOf, loadAccount, onAccountChange, watchAccount } from '../account';
import { keyFor, moveUnkeyedData } from '../accountStorage';

/** The colors a group can have: those both Badge and Token come in. */
export const GROUP_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'purple', 'pink'] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  name: string;
  color: GroupColor;
  /**
   * Lowercased, as Reddit's names ignore case. Kept when the user
   * unsubscribes, so subscribing again restores it.
   */
  subreddits: string[];
}

/** Which subreddits the page shows: all, those in no group, or one group's, by its ID. */
export type GroupFilter = 'all' | 'ungrouped' | (string & {});

// Extension storage like the subscriptions, unlike the display settings in
// localStorage: losing groups to cleared site data would lose real work.
// Each account has its own, as it has its own subscriptions.
const BASE_KEY = 'local:groups';

interface StoredGroups {
  groups: Group[];
  /**
   * The page that stored them, and its count of writes then, so it can tell
   * its own writes when storage reports them back.
   */
  writer?: { page: string; write: number };
}

export interface GroupsState {
  /** Sorted by name, so the order is the same everywhere groups are listed */
  groups: Group[];
  isLoaded: boolean;
  /**
   * Whether they can be changed: once loaded, and once Reddit confirmed the
   * account they're of. Changes made before they load would replace them.
   */
  isEditable: boolean;
  /**
   * Which account's groups these are, counting switches. Changes name the
   * session they were started in, and do nothing in another: an Undo of one
   * account's import must not replace another's groups.
   */
  session: number;
}

/** The groups of one account, or none while logged out */
interface Session {
  id: number;
  /** As accountKey() makes it, or null when logged out */
  account: string | null;
  item?: WxtStorageItem<StoredGroups, {}>;
  unwatch?: () => void;
  /** This page's writes that storage is yet to report back */
  pending: Set<number>;
  /** What to undo or close on switching away, e.g. a toast offering Undo */
  onEnd: Set<() => void>;
}

let state: GroupsState = { groups: [], isLoaded: false, isEditable: false, session: 0 };
let session: Session | undefined;
let sessions = 0;
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
/** This page, among those writing groups */
const page = crypto.randomUUID();
let writes = 0;

export function useGroups(): GroupsState {
  void load();
  return useSyncExternalStore(subscribe, () => state);
}

/** The groups, once the account's are loaded; the state as it is now, outside React */
export async function loadGroups(): Promise<GroupsState> {
  await load();
  return state;
}

/** The groups as they are now, outside React */
export function groupsNow(): GroupsState {
  return state;
}

function load(): Promise<void> {
  loading ??= (async () => {
    onAccountChange((name) => void open(name));
    // Editable once Reddit confirms the account, whether or not it changed
    watchAccount(() => session && publish(session, state.groups, state.isLoaded));
    // The account last seen's groups right away, as they're only stored here
    let name = accountName();
    if (name === undefined) name = (await loadAccount())?.name ?? null;
    // Unless Reddit reported an account meanwhile
    if (!session) await open(name);
  })();
  return loading;
}

async function open(name: string | null) {
  const account = keyOf(name);
  if (session && session.account === account) return;
  if (session) end(session);
  const s: Session = { id: ++sessions, account, pending: new Set(), onEnd: new Set() };
  session = s;
  publish(s, [], false);
  openFilter(account);
  // Logged out, there's nowhere to keep groups: they stay unloaded.
  if (!account) return;
  await moveUnkeyedData();
  if (s !== session) return;
  const item = storage.defineItem<StoredGroups>(keyFor(BASE_KEY, account), { fallback: { groups: [] } });
  // Follow changes made in other tabs. Storage reports writes in the order
  // it makes them, ours too, which are shown already.
  s.unwatch = item.watch((value) => {
    if (value.writer?.page === page) {
      for (const write of s.pending) if (write <= value.writer.write) s.pending.delete(write);
      return;
    }
    // Made before a write of ours still to come, which replaces it
    if (s.pending.size) return;
    publish(s, value.groups);
  });
  const stored = await item.getValue();
  if (s !== session) return;
  // Only now: saving before would replace what's stored.
  s.item = item;
  // Unless a change reported meanwhile showed later ones
  publish(s, state.isLoaded ? state.groups : stored.groups);
}

function end(s: Session) {
  s.unwatch?.();
  for (const fn of s.onEnd) fn();
  s.onEnd.clear();
}

/**
 * Calls `fn` when the session ends, on switching accounts, e.g. to close a
 * toast offering Undo, which would do nothing then.
 */
export function onSessionEnd(id: number, fn: () => void) {
  if (session?.id !== id) return fn();
  session.onEnd.add(fn);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Shows the groups, unless `s` is an account's switched away from. */
function publish(s: Session, groups: Group[], isLoaded = true) {
  if (s !== session) return;
  const isEditable = isLoaded && !!s.item && s.account === keyOf(confirmedAccount()?.name);
  const sorted = groups === state.groups ? groups : [...groups].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted === state.groups && isLoaded === state.isLoaded && isEditable === state.isEditable && s.id === state.session) {
    return;
  }
  state = { groups: sorted, isLoaded, isEditable, session: s.id };
  for (const listener of listeners) listener();
}

/**
 * Stores the groups as changed in session `id`. Returns whether it did: not
 * after switching accounts, nor before they're editable.
 */
function save(id: number, groups: Group[]): boolean {
  const s = session;
  const item = s?.item;
  if (!s || !item || s.id !== id || !state.isEditable) return false;
  publish(s, groups);
  const write = ++writes;
  s.pending.add(write);
  item.setValue({ groups: state.groups, writer: { page, write } }).catch(async (err) => {
    console.warn(err);
    s.pending.delete(write);
    // Show what's stored instead, which changes from other tabs held back
    // for this write may have changed
    if (s.pending.size) return;
    const stored = await item.getValue();
    if (!s.pending.size) publish(s, stored.groups);
  });
  return true;
}

/** Why a name can't be given to a group, if it can't */
export function nameProblem(name: string, exceptId?: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name';
  const taken = state.groups.some((g) => g.id !== exceptId && g.name.toLowerCase() === trimmed.toLowerCase());
  if (taken) return 'A group with that name already exists';
}

/** The color used least so far, so new groups tell apart from the others */
export function unusedColor(): GroupColor {
  const uses = new Map(GROUP_COLORS.map((c) => [c, 0]));
  for (const g of state.groups) uses.set(g.color, uses.get(g.color)! + 1);
  return GROUP_COLORS.reduce((best, c) => (uses.get(c)! < uses.get(best)! ? c : best));
}

// Each change names the session it was made in (GroupsState.session) and
// returns whether it was made.

export function createGroup(session: number, name: string, color: GroupColor, subreddits: string[] = []): boolean {
  const group = { id: crypto.randomUUID(), name: name.trim(), color, subreddits };
  return save(session, [...state.groups, group]);
}

export function editGroup(session: number, id: string, changes: Pick<Group, 'name' | 'color'>): boolean {
  return save(
    session,
    state.groups.map((g) => (g.id === id ? { ...g, ...changes, name: changes.name.trim() } : g)),
  );
}

export function deleteGroup(session: number, id: string): boolean {
  return save(
    session,
    state.groups.filter((g) => g.id !== id),
  );
}

/** Puts a deleted group back, e.g. on Undo. */
export function restoreGroup(session: number, group: Group): boolean {
  return save(session, [...state.groups.filter((g) => g.id !== group.id), group]);
}

export function setInGroup(session: number, groupId: string, subreddit: string, isIn: boolean): boolean {
  const name = subreddit.toLowerCase();
  return save(
    session,
    state.groups.map((g) => {
      if (g.id !== groupId || g.subreddits.includes(name) === isIn) return g;
      const subreddits = isIn ? [...g.subreddits, name] : g.subreddits.filter((s) => s !== name);
      return { ...g, subreddits };
    }),
  );
}

/** Puts back the groups as they were, e.g. on Undo of an import. */
export function setGroups(session: number, groups: Group[]): boolean {
  return save(session, groups);
}

/** What a groups file holds: no IDs, which only mean something here */
interface GroupsFile {
  format: typeof FILE_FORMAT;
  groups: Omit<Group, 'id'>[];
}

const FILE_FORMAT = 'rd3k-groups-1';

/** The groups as JSON, to save to a file */
export function exportGroups(groups: Group[]): string {
  const file: GroupsFile = {
    format: FILE_FORMAT,
    groups: groups.map(({ name, color, subreddits }) => ({ name, color, subreddits })),
  };
  return JSON.stringify(file, null, 2);
}

/** The groups in a file saved by exportGroups. Throws if it isn't one. */
export function parseGroupsFile(text: string): Omit<Group, 'id'>[] {
  const file = JSON.parse(text) as Partial<GroupsFile> | null;
  if (file?.format !== FILE_FORMAT || !Array.isArray(file.groups)) throw new Error('Not a groups file');
  return file.groups.map((g) => {
    const group = readGroup(g);
    if (!group) throw new Error('Not a groups file');
    return group;
  });
}

/** The name, color and subreddits of a group read from a file, cleaned up, or undefined if it isn't a group. */
export function readGroup(value: unknown): Omit<Group, 'id'> | undefined {
  const g = value as Partial<Group> | null;
  if (
    typeof g?.name !== 'string' ||
    !g.name.trim() ||
    !Array.isArray(g.subreddits) ||
    !g.subreddits.every((s) => typeof s === 'string')
  ) {
    return undefined;
  }
  return {
    name: g.name.trim(),
    // An unknown color, e.g. from a later version, shouldn't lose the group
    color: GROUP_COLORS.includes(g.color!) ? g.color! : 'blue',
    subreddits: [...new Set(g.subreddits.map((s) => s.toLowerCase().replace(/^\/?r\//, '')))],
  };
}

/**
 * The groups with the imported ones added. One with the name of an existing
 * group adds its subreddits to it and gives it its color, so importing a file
 * again changes nothing and no group is ever lost.
 */
export function mergeGroups(groups: Group[], imported: Omit<Group, 'id'>[]): Group[] {
  const merged = [...groups];
  for (const group of imported) {
    const i = merged.findIndex((g) => g.name.toLowerCase() === group.name.toLowerCase());
    if (i === -1) {
      merged.push({ ...group, id: crypto.randomUUID() });
    } else {
      const subreddits = [...new Set([...merged[i]!.subreddits, ...group.subreddits])];
      merged[i] = { ...merged[i]!, color: group.color, subreddits };
    }
  }
  return merged;
}

/**
 * Adds the groups in a file saved by exportGroups. Throws if it isn't one;
 * returns whether it added them, as other changes do.
 */
export function importGroups(session: number, text: string): boolean {
  return save(session, mergeGroups(state.groups, parseGroupsFile(text)));
}

// The filter is a display setting: in localStorage, so the page has it on
// first render, one per account like the groups. It's read once rather than
// following other tabs, which can show other groups.
const FILTER_KEY = 'groupFilter';
const filterKey = (account: string) => `${FILTER_KEY}:${account}`;
/** The account the filter is of, as accountKey() makes it */
let filterAccount = keyOf(accountName());
let filter = storedFilter(filterAccount);
const filterListeners = new Set<() => void>();

export function useGroupFilter(): GroupFilter {
  return useSyncExternalStore(subscribeToFilter, () => filter);
}

export function setGroupFilter(value: GroupFilter) {
  filter = value;
  const account = session?.account;
  try {
    if (account && value === 'all') localStorage.removeItem(filterKey(account));
    else if (account) localStorage.setItem(filterKey(account), value);
  } catch (err) {
    console.warn(err);
  }
  for (const listener of filterListeners) listener();
}

/** Shows the filter last chosen with the account. */
function openFilter(account: string | null) {
  if (account === filterAccount) return;
  filterAccount = account;
  filter = storedFilter(account);
  for (const listener of filterListeners) listener();
}

/**
 * The group filter last chosen, and whether a subreddit passes it. A group
 * deleted meanwhile, e.g. in another tab, leaves all subreddits shown.
 */
export function useSubredditFilter() {
  const { groups, isLoaded } = useGroups();
  const stored = useGroupFilter();
  const group = groups.find((g) => g.id === stored);
  const current: GroupFilter = stored === 'ungrouped' || group || !isLoaded ? stored : 'all';

  const includes = useMemo(() => {
    if (current === 'all') return () => true;
    if (current === 'ungrouped') {
      const grouped = new Set(groups.flatMap((g) => g.subreddits));
      return (name: string) => !grouped.has(name.toLowerCase());
    }
    const names = new Set(groups.find((g) => g.id === current)?.subreddits);
    return (name: string) => names.has(name.toLowerCase());
  }, [current, groups]);

  return { filter: current, group, includes };
}

function subscribeToFilter(onChange: () => void) {
  filterListeners.add(onChange);
  return () => filterListeners.delete(onChange);
}

function storedFilter(account: string | null | undefined): GroupFilter {
  if (!account) return 'all';
  try {
    return localStorage.getItem(filterKey(account)) ?? localStorage.getItem(FILTER_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

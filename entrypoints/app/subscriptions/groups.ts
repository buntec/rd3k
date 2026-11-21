import { useMemo, useSyncExternalStore } from 'react';
import { accountKey, accountName, loadAccount, onAccountChange } from '../account';
import { adoptUnkeyed, keyFor } from '../accountStorage';

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
}

/** The groups of one account, or none while logged out */
interface Session {
  /** As accountKey() makes it, or null when logged out */
  account: string | null;
  item?: WxtStorageItem<StoredGroups, {}>;
  unwatch?: () => void;
  /** This page's writes that storage is yet to report back */
  pending: Set<number>;
}

let state: GroupsState = { groups: [], isLoaded: false };
let session: Session | undefined;
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
/** This page, among those writing groups */
const page = crypto.randomUUID();
let writes = 0;

export function useGroups(): GroupsState {
  void load();
  return useSyncExternalStore(subscribe, () => state);
}

function load(): Promise<void> {
  loading ??= (async () => {
    onAccountChange((name) => void open(name));
    // The account last seen's groups right away, as they're only stored here
    let name = accountName();
    if (name === undefined) name = (await loadAccount())?.name ?? null;
    // Unless Reddit reported an account meanwhile
    if (!session) await open(name);
  })();
  return loading;
}

async function open(name: string | null) {
  const account = name && accountKey(name);
  if (session && session.account === account) return;
  session?.unwatch?.();
  const s: Session = { account, pending: new Set() };
  session = s;
  publish(s, [], false);
  openFilter(account);
  if (!account) {
    publish(s, []);
    return;
  }
  await adoptUnkeyedGroups(account);
  if (s !== session) return;
  const item = storage.defineItem<StoredGroups>(keyFor(BASE_KEY, account), { fallback: { groups: [] } });
  s.item = item;
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
  // Unless a change reported meanwhile showed later ones
  if (!state.isLoaded) publish(s, stored.groups);
}

/** Gives the account the groups from before each account had its own, and the filter chosen then. */
async function adoptUnkeyedGroups(account: string) {
  await adoptUnkeyed(BASE_KEY, account);
  try {
    const unkeyed = localStorage.getItem(FILTER_KEY);
    if (unkeyed === null) return;
    if (localStorage.getItem(filterKey(account)) === null) localStorage.setItem(filterKey(account), unkeyed);
    localStorage.removeItem(FILTER_KEY);
  } catch (err) {
    console.warn(err);
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Shows the groups, unless `s` is an account's switched away from. */
function publish(s: Session, groups: Group[], isLoaded = true) {
  if (s !== session) return;
  state = { groups: [...groups].sort((a, b) => a.name.localeCompare(b.name)), isLoaded };
  for (const listener of listeners) listener();
}

function save(groups: Group[]) {
  const s = session;
  if (!s) return;
  publish(s, groups);
  const { item } = s;
  // Logged out, there's nowhere to keep them; the page has nothing to group then.
  if (!item) return;
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

export function createGroup(name: string, color: GroupColor, subreddits: string[] = []): Group {
  const group = { id: crypto.randomUUID(), name: name.trim(), color, subreddits };
  save([...state.groups, group]);
  return group;
}

export function editGroup(id: string, changes: Pick<Group, 'name' | 'color'>) {
  save(state.groups.map((g) => (g.id === id ? { ...g, ...changes, name: changes.name.trim() } : g)));
}

export function deleteGroup(id: string) {
  save(state.groups.filter((g) => g.id !== id));
}

/** Puts a deleted group back, e.g. on Undo. */
export function restoreGroup(group: Group) {
  save([...state.groups.filter((g) => g.id !== group.id), group]);
}

export function setInGroup(groupId: string, subreddit: string, isIn: boolean) {
  const name = subreddit.toLowerCase();
  save(
    state.groups.map((g) => {
      if (g.id !== groupId || g.subreddits.includes(name) === isIn) return g;
      const subreddits = isIn ? [...g.subreddits, name] : g.subreddits.filter((s) => s !== name);
      return { ...g, subreddits };
    }),
  );
}

/** Puts back the groups as they were, e.g. on Undo of an import. */
export function setGroups(groups: Group[]) {
  save(groups);
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

/** Adds the groups in a file saved by exportGroups. Throws if it isn't one. */
export function importGroups(text: string) {
  save(mergeGroups(state.groups, parseGroupsFile(text)));
}

// The filter is a display setting: in localStorage, so the page has it on
// first render, one per account like the groups. It's read once rather than
// following other tabs, which can show other groups.
const FILTER_KEY = 'groupFilter';
const filterKey = (account: string) => `${FILTER_KEY}:${account}`;
const initialName = accountName();
/** The account the filter is of, as accountKey() makes it */
let filterAccount = initialName && accountKey(initialName);
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

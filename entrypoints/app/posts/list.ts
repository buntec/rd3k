import { useSyncExternalStore } from 'react';
import type { Listing } from '@/utils/reddit';

export interface ListState<T> {
  items: T[];
  /** Where the next page starts, if there is one */
  after?: string;
  loading: 'idle' | 'refresh' | 'more';
  /** Loading failed. Also stops loading more on scroll. */
  error?: string;
  /** Removing an item, or undoing that, failed */
  removalError?: string;
  /** Items the user took out of the list, by fullname */
  removals: Partial<Record<string, Removal>>;
}

/** An item the user took out of the list, shown as a message with Undo */
export interface Removal {
  message: string;
  undo?: () => Promise<void>;
  status: 'sending' | 'sent' | 'undoing';
}

export type ItemList<T extends { fullname: string }> = ReturnType<typeof createList<T>>;

/**
 * A list loaded page by page from Reddit. It lives outside React, so switching
 * pages keeps it, and loads when a page first uses it.
 */
export function createList<T extends { fullname: string }>(
  load: (after?: string) => Promise<Listing<T>>,
) {
  let state: ListState<T> = { items: [], loading: 'idle', removals: {} };
  const listeners = new Set<() => void>();
  let isStale = true;

  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  };

  function update(patch: Partial<ListState<T>>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function setRemoval(fullname: string, removal: Removal | undefined) {
    const { [fullname]: _, ...others } = state.removals;
    update({ removals: removal ? { ...others, [fullname]: removal } : others });
  }

  const list = {
    use(): ListState<T> {
      if (isStale) {
        isStale = false;
        // Nothing renders this list yet, so updating during render is safe,
        // and the first render already shows it loading.
        void list.refresh();
      }
      return useSyncExternalStore(subscribe, () => state);
    },

    /** Loads the list again the next time a page shows it. */
    invalidate() {
      isStale = true;
    },

    /** Replaces the list with a fresh first page. */
    async refresh() {
      if (state.loading !== 'idle') return;
      update({ loading: 'refresh', error: undefined });
      try {
        const page = await load();
        update({ items: page.items, after: page.after, removals: {}, removalError: undefined });
      } catch (err) {
        update({ error: errorMessage(err) });
      } finally {
        update({ loading: 'idle' });
      }
    },

    /** Appends the next page, skipping items already in the list. */
    async loadMore() {
      if (state.loading !== 'idle' || !state.after) return;
      update({ loading: 'more', error: undefined });
      try {
        const page = await load(state.after);
        const seen = new Set(state.items.map((item) => item.fullname));
        update({
          items: [...state.items, ...page.items.filter((item) => !seen.has(item.fullname))],
          after: page.after,
        });
      } catch (err) {
        update({ error: errorMessage(err) });
      } finally {
        update({ loading: 'idle' });
      }
    },

    /** Changes one item in place, e.g. after a vote. */
    replace(fullname: string, change: (item: T) => T) {
      update({ items: state.items.map((item) => (item.fullname === fullname ? change(item) : item)) });
    },

    /**
     * Takes the item out of the list right away and tells Reddit with `send`.
     * The item comes back if that fails.
     */
    async remove(
      fullname: string,
      { send, ...removal }: Omit<Removal, 'status'> & { send: () => Promise<void> },
    ) {
      if (state.removals[fullname]) return;
      setRemoval(fullname, { ...removal, status: 'sending' });
      update({ removalError: undefined });
      try {
        await send();
        // Unless a refresh replaced the list in the meantime
        if (state.removals[fullname]) setRemoval(fullname, { ...removal, status: 'sent' });
      } catch (err) {
        setRemoval(fullname, undefined);
        update({ removalError: `That didn't work: ${errorMessage(err)}` });
      }
    },

    /** Takes back a removal and shows the item again. */
    async undoRemoval(fullname: string) {
      const removal = state.removals[fullname];
      if (removal?.status !== 'sent' || !removal.undo) return;
      setRemoval(fullname, { ...removal, status: 'undoing' });
      update({ removalError: undefined });
      try {
        await removal.undo();
        setRemoval(fullname, undefined);
      } catch (err) {
        if (state.removals[fullname]) setRemoval(fullname, removal);
        update({ removalError: `Undo didn't work: ${errorMessage(err)}` });
      }
    },
  };
  return list;
}

function errorMessage(err: unknown) {
  console.warn(err);
  return err instanceof Error ? err.message : String(err);
}

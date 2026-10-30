import { useCallback, useSyncExternalStore } from 'react';

// Client-side persistence for the demo. Every store keeps its state in memory,
// shared by every screen that reads it, and saves to localStorage so changes
// survive navigation and reloads. In production these stores become API
// resources; the hooks are the seam to swap.

const PREFIX = 'gfsa.v1.';

export interface Store<T> {
  get: () => T;
  set: (fn: (s: T) => T) => void;
  subscribe: (l: () => void) => () => void;
  /** Back to the seed value (and forget the saved copy). */
  reset: () => void;
}

const registry = new Map<string, Store<unknown>>();

function read<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Private mode or quota: the in-memory copy still works for this session.
  }
}

/**
 * A store shared by every screen. Pass `persist: false` for state that should
 * live only in memory (it still survives navigation).
 */
export function createStore<T>(key: string, initial: T | (() => T), opts: { persist?: boolean } = {}): Store<T> {
  const existing = registry.get(key);
  if (existing) return existing as Store<T>;
  const persist = opts.persist !== false;
  const seed = () => (typeof initial === 'function' ? (initial as () => T)() : initial);
  let state: T = (persist ? read<T>(key) : undefined) ?? seed();
  const subs = new Set<() => void>();
  let saveTimer: number | undefined;
  const save = () => {
    if (!persist) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => write(key, state), 150);
  };
  const store: Store<T> = {
    get: () => state,
    set: (fn) => {
      const next = fn(state);
      if (next === state) return;
      state = next;
      save();
      subs.forEach((l) => l());
    },
    subscribe: (l) => {
      subs.add(l);
      return () => {
        subs.delete(l);
      };
    },
    reset: () => {
      state = seed();
      try {
        window.localStorage.removeItem(PREFIX + key);
      } catch {
        /* ignore */
      }
      subs.forEach((l) => l());
    },
  };
  registry.set(key, store as Store<unknown>);
  return store;
}

// Keep windows in step: the video wall on a second screen, the wheelhouse
// display and the console share one saved state. When another window saves a
// store, reload it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const store = registry.get(e.key.slice(PREFIX.length));
    if (!store || e.newValue === null) return;
    try {
      const next = JSON.parse(e.newValue);
      store.set(() => next);
    } catch {
      /* ignore */
    }
  });
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Drop-in for useState whose value is shared by key across screens and saved.
 * Use it for domain data (schedules, settings, lists), not for UI-only state
 * such as an open dialog or a hover.
 */
export function usePersistentState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const store = createStore<T>(key, initial);
  const value = useStore(store);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => store.set((prev) => (typeof v === 'function' ? (v as (p: T) => T)(prev) : v)),
    [store],
  );
  return [value, set];
}

/**
 * Reads a store's saved value without registering the store (so the screen
 * that owns it keeps its own seed). For cross-screen reads such as the
 * integration switches the live engine respects.
 */
export function readSaved<T>(key: string): T | undefined {
  const live = registry.get(key);
  if (live) return live.get() as T;
  return read<T>(key);
}

/** Clears every saved store and reloads: the demo starts again at 14:36:20. */
export function resetDemoData() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  window.location.assign('/sign-in');
}

/** A short id that stays unique across reloads (for rows created in the demo). */
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

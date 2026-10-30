import { useSyncExternalStore } from 'react';

// Client-side persistence for the prototype. Each store keeps its state in
// memory, shared by every screen, and saves to localStorage so changes survive
// reloads and stay in step across windows (the wall on a second screen, the
// phone page). In production these stores become API resources; the hooks are
// the seam to swap.

const PREFIX = 'qsi.v1.';

export interface Store<T> {
  get: () => T;
  set: (fn: (s: T) => T) => void;
  subscribe: (l: () => void) => () => void;
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

/** Pass `persist: false` for state that lives only in memory (toasts, live counts). */
export function createStore<T>(key: string, initial: T | (() => T), opts: { persist?: boolean } = {}): Store<T> {
  const existing = registry.get(key);
  if (existing) return existing as Store<T>;
  const persist = opts.persist !== false;
  const seed = () => (typeof initial === 'function' ? (initial as () => T)() : initial);
  let state: T = (persist ? read<T>(key) : undefined) ?? seed();
  const subs = new Set<() => void>();
  let timer: number | undefined;
  const store: Store<T> = {
    get: () => state,
    set: (fn) => {
      const next = fn(state);
      if (next === state) return;
      state = next;
      if (persist) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => write(key, state), 120);
      }
      subs.forEach((l) => l());
    },
    subscribe: (l) => {
      subs.add(l);
      return () => void subs.delete(l);
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

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Clears every saved store and starts the sample data again. */
export function resetAll() {
  registry.forEach((s) => s.reset());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX) || e.newValue === null) return;
    const store = registry.get(e.key.slice(PREFIX.length));
    if (!store) return;
    try {
      const value = JSON.parse(e.newValue);
      store.set(() => value);
    } catch {
      /* ignore */
    }
  });
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

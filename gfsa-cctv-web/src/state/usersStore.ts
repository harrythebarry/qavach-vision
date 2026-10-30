import { users as seedUsers } from '../data/users';
import type { RoleId, User } from '../data/types';
import { createStore, useStore } from '../lib/persist';

// The user directory (ADM-01, ADM-02), saved. "Users and roles" edits it;
// alert routing picks recipients from it; the demo role switcher signs in as
// the first active user with each role.

export const usersStore = createStore<User[]>('users', () => seedUsers.map((u) => ({ ...u })));

export const useUsers = () => useStore(usersStore);

export function updateUser(id: string, patch: Partial<User>) {
  usersStore.set((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
}

export function addUser(u: User) {
  usersStore.set((list) => [...list, u]);
}

export function removeUser(id: string) {
  usersStore.set((list) => list.filter((u) => u.id !== id));
}

/** The signed-in demo user for a role: the first active user who holds it. */
export function demoUserFor(role: RoleId): User {
  const list = usersStore.get();
  return (
    list.find((u) => u.role === role && u.status === 'active') ??
    list.find((u) => u.role === role) ??
    seedUsers.find((u) => u.role === role)!
  );
}

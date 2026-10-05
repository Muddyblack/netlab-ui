// Per-login UI state that is kept on the server (pinned/recent labs, exercise
// progress) so it follows the user across browsers and machines.
//
// Reads are synchronous from an in-memory cache so components render
// immediately: the cache starts from localStorage (the previous home of this
// data, and the only home in the backend-less demo), then `loadUserState()`
// replaces it with the server's copy. Keys the server has never seen are
// uploaded from the local copy once, so nobody loses what they already had.
// Writes update the cache, localStorage and the server; a failed server write
// is not fatal, the next successful one carries the full value.

import { useSyncExternalStore } from "react";
import { DEMO_MODE } from "../lifecycle/types";
import { readJson, writeJson } from "../utils/storage";
import { getApiBase } from "./endpoint";

export type UserStateShape = {
  pinnedLabs: string[];
  recentLabs: string[];
  /** Passed step ids per tour. */
  exerciseProgress: Record<string, string[]>;
};
export type UserStateKey = keyof UserStateShape;

const DEFAULTS: UserStateShape = { pinnedLabs: [], recentLabs: [], exerciseProgress: {} };

// localStorage keys the data used to live under (and still mirrors into).
const LOCAL_KEYS: Record<UserStateKey, string> = {
  pinnedLabs: "netlab:pinned-labs-v1",
  recentLabs: "netlab:recent-labs-v1",
  exerciseProgress: "netlab.user.exerciseProgress"
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const isProgress = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isStringArray);

const CHECKS: { [K in UserStateKey]: (value: unknown) => value is UserStateShape[K] } = {
  pinnedLabs: isStringArray,
  recentLabs: isStringArray,
  exerciseProgress: isProgress
};

const cache: UserStateShape = {
  pinnedLabs: readJson(LOCAL_KEYS.pinnedLabs, DEFAULTS.pinnedLabs, CHECKS.pinnedLabs),
  recentLabs: readJson(LOCAL_KEYS.recentLabs, DEFAULTS.recentLabs, CHECKS.recentLabs),
  exerciseProgress: readJson(LOCAL_KEYS.exerciseProgress, DEFAULTS.exerciseProgress, CHECKS.exerciseProgress)
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function setCached<K extends UserStateKey>(key: K, value: UserStateShape[K]) {
  cache[key] = value;
  writeJson(LOCAL_KEYS[key], value);
  notify();
}

async function putRemote<K extends UserStateKey>(key: K, value: UserStateShape[K]): Promise<void> {
  if (DEMO_MODE) return;
  try {
    await fetch(`${getApiBase()}/api/user-state/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    });
  } catch {
    // Offline or backend restarting: the local copy still has it.
  }
}

export function readUserState<K extends UserStateKey>(key: K): UserStateShape[K] {
  return cache[key];
}

export function writeUserState<K extends UserStateKey>(key: K, value: UserStateShape[K]): void {
  setCached(key, value);
  void putRemote(key, value);
}

/** Adopt the server's copy once the backend is reachable. */
export async function loadUserState(): Promise<void> {
  if (DEMO_MODE) return;
  try {
    const res = await fetch(`${getApiBase()}/api/user-state`);
    if (!res.ok) return;
    const remote = (await res.json()) as Partial<Record<UserStateKey, unknown>>;
    for (const key of Object.keys(DEFAULTS) as UserStateKey[]) {
      const value = remote[key];
      if (value !== undefined && CHECKS[key](value)) {
        setCached(key, value as never);
      } else if (JSON.stringify(cache[key]) !== JSON.stringify(DEFAULTS[key])) {
        void putRemote(key, cache[key]);
      }
    }
  } catch {
    // Keep working from the local copy.
  }
}

export function useUserState<K extends UserStateKey>(key: K): UserStateShape[K] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cache[key]
  );
}

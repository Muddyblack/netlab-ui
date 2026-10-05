import { useCallback, useMemo } from "react";

import type { TeachingDocument } from "../../../api/client";
import { useUserState, writeUserState } from "../../../api/userState";
import { isStringArray, readJson } from "../../../utils/storage";

/** Which exercise steps this login has passed, per tour (steps have stable
 * ids, so editing a caption doesn't lose progress). Kept on the server with
 * the rest of the per-user state, so it follows the user across browsers. */
function tourKey(doc: TeachingDocument): string {
  return `${doc.id}.${doc.title}`;
}

/** Progress saved by earlier versions, one localStorage key per tour. */
function legacyProgress(key: string): string[] {
  return readJson<string[]>(`netlab.exercise.progress.${key}`, [], isStringArray);
}

export function useExerciseProgress(doc: TeachingDocument) {
  const key = tourKey(doc);
  const all = useUserState("exerciseProgress");
  const stored = all[key];
  const passed = useMemo(() => new Set(stored ?? legacyProgress(key)), [stored, key]);
  const save = useCallback(
    (next: Set<string>) => writeUserState("exerciseProgress", { ...all, [key]: [...next] }),
    [all, key]
  );
  const markPassed = useCallback((stepId: string) => save(new Set([...passed, stepId])), [passed, save]);
  const reset = useCallback(() => save(new Set()), [save]);
  const graded = doc.steps.filter((step) => step.checks.length > 0);
  return {
    passed,
    markPassed,
    reset,
    graded: graded.length,
    done: graded.filter((step) => passed.has(step.id)).length,
  };
}

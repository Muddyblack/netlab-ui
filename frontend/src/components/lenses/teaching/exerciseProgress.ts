import { useCallback, useState } from "react";

import type { TeachingDocument } from "../../../api/client";

/** Which exercise steps this browser has passed, per tour (steps have stable
 * ids, so editing a caption doesn't lose progress). */
function storageKey(doc: TeachingDocument): string {
  return `netlab.exercise.progress.${doc.id}.${doc.title}`;
}

function load(doc: TeachingDocument): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(doc)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function useExerciseProgress(doc: TeachingDocument) {
  const [passed, setPassed] = useState<Set<string>>(() => load(doc));
  const save = useCallback((next: Set<string>) => {
    setPassed(next);
    try { localStorage.setItem(storageKey(doc), JSON.stringify([...next])); } catch { /* progress is a convenience */ }
  }, [doc]);
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

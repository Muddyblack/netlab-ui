import { Autocomplete, Chip, TextField, Typography } from "@mui/material";

import type { TeachingStep, ValidationTestInfo } from "../../../api/client";

/** Authoring side of an exercise step: the task, an optional hint, and the
 * lab's `netlab validate` tests that prove the task is done. */
export function ExerciseFields({ step, tests, onChange }: {
  step: TeachingStep;
  tests: ValidationTestInfo[];
  onChange: (patch: Partial<TeachingStep>) => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <>
      <TextField fullWidth size="small" multiline minRows={2} label="Task for the student (optional)" value={step.task}
        onClick={stop} onChange={(event) => onChange({ task: event.target.value })} sx={{ mt: 1 }}
        placeholder="e.g. Add a static route on r1 so it reaches r3's loopback" />
      <Autocomplete
        multiple
        size="small"
        options={tests.map((test) => test.name)}
        value={step.checks}
        onChange={(_event, value) => onChange({ checks: value })}
        onClick={stop}
        renderTags={(value, getTagProps) => value.map((name, index) => <Chip {...getTagProps({ index })} key={name} size="small" label={name} />)}
        renderOption={(props, name) => {
          const test = tests.find((item) => item.name === name);
          return (
            <li {...props} key={name}>
              <Typography variant="body2" sx={{ fontFamily: "monospace", mr: 1 }}>{name}</Typography>
              <Typography variant="caption" color="text.secondary">{test?.description}</Typography>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField {...params} label="Checks (netlab validate tests)"
            helperText={tests.length ? "The step passes when all of them pass." : "This lab has no validate: tests — add some to the topology to check exercises."} />
        )}
        sx={{ mt: 1 }}
      />
      {step.checks.length > 0 && (
        <TextField fullWidth size="small" label="Hint (shown after a failed check)" value={step.hint}
          onClick={stop} onChange={(event) => onChange({ hint: event.target.value })} sx={{ mt: 1 }} />
      )}
    </>
  );
}

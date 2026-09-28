import { useState } from "react";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";

import { api, type TeachingCheckResult, type TeachingStep } from "../../../api/client";

/** Presenter side of an exercise step: the task, "Check my work", and the
 * per-test outcome (with the hint once a check failed). */
export function ExerciseCheck({ sessionId, step, alreadyPassed, onPassed }: {
  sessionId: string;
  step: TeachingStep;
  alreadyPassed: boolean;
  onPassed: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TeachingCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setRunning(true);
    setError(null);
    try {
      const outcome = await api.checkTeachingStep(sessionId, step.checks);
      setResult(outcome);
      if (outcome.passed) onPassed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Box sx={{ textAlign: "left", mt: 1 }}>
      {step.task && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
          <strong>Your task:</strong> {step.task}
        </Typography>
      )}
      {step.checks.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" variant="contained" startIcon={running ? <CircularProgress size={14} color="inherit" /> : <FactCheckOutlinedIcon />}
            disabled={running} onClick={() => void check()}>
            {running ? "Checking…" : "Check my work"}
          </Button>
          {(alreadyPassed || result?.passed) && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "success.main" }}>
              <CheckCircleIcon fontSize="small" />
              <Typography variant="body2">Done</Typography>
            </Stack>
          )}
        </Stack>
      )}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {result && !result.passed && (
        <Alert severity="warning" sx={{ mt: 1, textAlign: "left" }}>
          {result.tests.filter((test) => test.state !== "passed").map((test) => (
            <Box key={test.name} sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>{test.name}: {test.state}</Typography>
              {test.evidence && (
                <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                  {test.evidence.split("\n").filter((line) => !line.startsWith("[" + test.name)).slice(0, 4).join("\n")}
                </Typography>
              )}
            </Box>
          ))}
          {step.hint && <Typography variant="body2" sx={{ mt: 0.5 }}><strong>Hint:</strong> {step.hint}</Typography>}
        </Alert>
      )}
    </Box>
  );
}

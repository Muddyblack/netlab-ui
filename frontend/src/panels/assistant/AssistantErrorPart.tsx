import { Alert } from "@mui/material";
import type { DataMessagePartProps } from "@assistant-ui/react";

export function AssistantError({ data }: DataMessagePartProps<{ message: string }>) {
  return (
    <Alert severity="error" sx={{ py: 0.25, "& .MuiAlert-message": { fontSize: "0.8125rem" } }}>
      {data.message}
    </Alert>
  );
}

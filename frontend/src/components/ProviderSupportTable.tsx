import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import TonalityIcon from "@mui/icons-material/Tonality";

import { PROVIDER_CAPABILITIES, PROVIDER_NAMES, type ProviderId, type Support } from "../netlabProviders";

const PROVIDERS = Object.keys(PROVIDER_NAMES) as ProviderId[];

const MARK: Record<Support, { icon: React.ReactNode; label: string }> = {
  yes: { icon: <CheckCircleIcon fontSize="small" color="success" />, label: "Supported" },
  partial: { icon: <TonalityIcon fontSize="small" color="warning" />, label: "Partly supported" },
  no: { icon: <RemoveCircleOutlineIcon fontSize="small" color="disabled" />, label: "Not supported" }
};

/** Which netlab-ui features work with which netlab provider. Hover a mark
 * for the reason behind a partial or missing one. */
export function ProviderSupportTable() {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">What works with which netlab provider</Typography>
      <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small" aria-label="Feature support per netlab provider">
          <TableHead>
            <TableRow>
              <TableCell>Feature</TableCell>
              {PROVIDERS.map((provider) => (
                <TableCell key={provider} align="center" sx={{ whiteSpace: "nowrap" }}>{PROVIDER_NAMES[provider]}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {PROVIDER_CAPABILITIES.map((row) => (
              <TableRow key={row.feature} hover>
                <TableCell>{row.feature}</TableCell>
                {PROVIDERS.map((provider) => {
                  const support = row.support[provider];
                  const note = row.note?.[provider];
                  const title = note ? `${MARK[support].label}: ${note}` : MARK[support].label;
                  return (
                    <TableCell key={provider} align="center">
                      <Tooltip title={title} describeChild>
                        <Box component="span" role="img" aria-label={title} sx={{ display: "inline-flex", cursor: note ? "help" : "default" }}>
                          {MARK[support].icon}
                        </Box>
                      </Tooltip>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Mixed labs work: every node follows its own provider (<code>provider:</code> on the node, else the lab&apos;s).
        Anything not possible for a node says why instead of failing silently. Hover a mark for details.
      </Typography>
    </Stack>
  );
}

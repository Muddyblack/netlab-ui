import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Chip, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DevicesIcon from "@mui/icons-material/Devices";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";

import type { GroupInfo } from "./types";
import { DetailSection, StatPill } from "./DetailSection";
import { NodeSetChips } from "../../components/common/NodeSetChips";

function AttributeRow({ index, entryKey, value }: { index: number; entryKey: string; value: unknown }) {
  const display = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const multiLine = display.includes("\n") || display.length > 48;
  return (
    <Box
      sx={{
        px: 1,
        py: 0.7,
        borderTop: index === 0 ? "none" : "1px solid",
        borderColor: "divider",
        bgcolor: index % 2 === 0 ? "action.hover" : "transparent",
        minWidth: 0
      }}
    >
      <Typography
        variant="caption"
        component="div"
        sx={{ fontFamily: "monospace", fontWeight: 700, color: "text.primary", wordBreak: "break-word", mb: 0.25 }}
      >
        {entryKey}
      </Typography>
      <Typography
        variant="caption"
        component="pre"
        color="text.secondary"
        sx={{
          fontFamily: "monospace",
          m: 0,
          p: multiLine ? 0.6 : 0,
          borderRadius: 0.75,
          bgcolor: multiLine ? "background.default" : "transparent",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          lineHeight: 1.45,
          maxWidth: "100%"
        }}
      >
        {display}
      </Typography>
    </Box>
  );
}

export function GroupCard({
  group,
  groupNames,
  expanded,
  onToggle,
  onEdit,
  onDelete
}: {
  group: GroupInfo;
  groupNames: Set<string>;
  expanded: boolean;
  onToggle: (name: string) => void;
  onEdit: (group: GroupInfo) => void;
  onDelete: (group: GroupInfo) => void;
}) {
  const nestedMembers = group.members.filter((m) => groupNames.has(m));
  const nodeMembers = group.members.filter((m) => !groupNames.has(m));
  const attrCount = Object.keys(group.attrs).length;
  const hasContent = group.members.length > 0 || group.module.length > 0 || attrCount > 0;

  return (
    <Accordion
      expanded={expanded}
      onChange={() => onToggle(group.name)}
      disableGutters
      elevation={0}
      sx={{
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: expanded ? "primary.main" : "divider",
        borderRadius: "10px !important",
        // Clip only when collapsed so the rounded corners look clean; allow
        // full expanded content (e.g. long advanced settings) to stay visible.
        overflow: expanded ? "visible" : "hidden",
        transition: "border-color 0.15s ease",
        "&:before": { display: "none" },
        "&.Mui-expanded": { margin: 0 },
        "&:hover": { borderColor: expanded ? "primary.main" : "text.disabled" }
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        sx={{
          minHeight: 48,
          px: 1.25,
          py: 0.5,
          borderRadius: expanded ? "10px 10px 0 0" : "10px",
          "& .MuiAccordionSummary-content": {
            my: 0.75,
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            overflow: "hidden"
          },
          "& .MuiAccordionSummary-expandIconWrapper": {
            color: "text.secondary"
          }
        }}
      >
        <Avatar
          variant="rounded"
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            bgcolor: expanded ? "primary.main" : "action.selected",
            color: expanded ? "primary.contrastText" : "text.secondary",
            transition: "background-color 0.15s ease"
          }}
        >
          <AccountTreeIcon sx={{ fontSize: 17 }} />
        </Avatar>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
            {group.name}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.4, flexWrap: "wrap", rowGap: 0.4 }}>
            <StatPill
              icon={<DevicesIcon />}
              label={`${group.members.length} ${group.members.length === 1 ? "member" : "members"}`}
              empty={group.members.length === 0}
            />
            <StatPill
              icon={<ExtensionOutlinedIcon />}
              label={`${group.module.length} ${group.module.length === 1 ? "module" : "modules"}`}
              empty={group.module.length === 0}
            />
            {attrCount > 0 && (
              <StatPill
                icon={<TuneOutlinedIcon />}
                label={`${attrCount} ${attrCount === 1 ? "setting" : "settings"}`}
              />
            )}
          </Stack>
        </Box>

        {/*
          AccordionSummary renders a <button>, so these actions must not render
          buttons of their own — nested buttons are invalid HTML and React warns
          about it. `component="span"` keeps ButtonBase's keyboard handling and
          role="button" while emitting a span.
        */}
        <Stack
          direction="row"
          spacing={0.25}
          sx={{ flexShrink: 0, mr: 0.25 }}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => event.stopPropagation()}
        >
          <Tooltip title="Edit group">
            <IconButton
              component="span"
              size="small"
              aria-label={`Edit ${group.name}`}
              onClick={() => onEdit(group)}
            >
              <EditOutlinedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete group">
            <IconButton
              component="span"
              size="small"
              color="error"
              aria-label={`Delete ${group.name}`}
              onClick={() => onDelete(group)}
            >
              <DeleteOutlineIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </AccordionSummary>

      <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.75, overflow: "visible" }}>
        <Divider sx={{ mb: 1.25 }} />

        {!hasContent ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", textAlign: "center", py: 1 }}>
            Empty group — edit to add members or modules.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <DetailSection
              icon={<DevicesIcon />}
              title="Members"
              count={group.members.length}
              emptyHint="No members yet"
            >
              <Stack spacing={0.85}>
                {nodeMembers.length > 0 && (
                  <Box>
                    {nestedMembers.length > 0 && (
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 0.4, fontWeight: 600 }}>
                        Nodes
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <NodeSetChips names={nodeMembers} variant="filled" sx={{ bgcolor: "action.hover" }} />
                    </Box>
                  </Box>
                )}
                {nestedMembers.length > 0 && (
                  <Box>
                    {nodeMembers.length > 0 && (
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 0.4, fontWeight: 600 }}>
                        Nested groups
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {nestedMembers.map((member) => (
                        <Chip
                          key={member}
                          size="small"
                          variant="outlined"
                          color="primary"
                          icon={<AccountTreeIcon sx={{ fontSize: "14px !important" }} />}
                          label={member}
                          sx={{ height: 22, fontSize: "0.72rem" }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
              </Stack>
            </DetailSection>

            <DetailSection
              icon={<ExtensionOutlinedIcon />}
              title="Modules"
              count={group.module.length}
              emptyHint="No modules enabled"
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {group.module.map((module) => (
                  <Chip
                    key={module}
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={module}
                    sx={{ height: 22, fontSize: "0.72rem", fontWeight: 600 }}
                  />
                ))}
              </Box>
            </DetailSection>

            {attrCount > 0 && (
              <DetailSection
                icon={<TuneOutlinedIcon />}
                title="Advanced settings"
                count={attrCount}
                emptyHint=""
              >
                <Stack
                  spacing={0}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    overflow: "visible"
                  }}
                >
                  {Object.entries(group.attrs).map(([key, value], index) => (
                    <AttributeRow key={key} index={index} entryKey={key} value={value} />
                  ))}
                </Stack>
              </DetailSection>
            )}
          </Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

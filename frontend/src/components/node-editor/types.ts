import type { NodeEditorData } from "@srl-labs/clab-ui";

/**
 * clab-ui's NodeEditorData models containerlab node fields only. netlab nodes
 * carry additional attributes (device/role/provider/box, config/skip_config,
 * plus arbitrary module settings) that ride along on the same object but
 * aren't part of the upstream type.
 */
export type NetlabNodeEditorData = NodeEditorData & {
  device?: string;
  role?: string;
  provider?: string;
  box?: string;
  config?: string[] | string;
  skip_config?: string[] | string;
  module?: string[];
  [key: string]: unknown;
};

export type NetlabOnChange = (updates: Partial<NetlabNodeEditorData>) => void;

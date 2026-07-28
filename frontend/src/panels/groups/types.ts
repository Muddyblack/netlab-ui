export interface GroupInfo {
  name: string;
  members: string[];
  module: string[];
  attrs: Record<string, unknown>;
}

export interface GroupsPayload {
  groups: GroupInfo[];
  nodes: string[];
}

export type MemberOption = { name: string; kind: "Node" | "Nested group" };

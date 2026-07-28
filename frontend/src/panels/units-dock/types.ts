export interface UnitNode {
  name: string;
  device?: string;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

export interface UnitLink {
  endpoints?: string[];
  attrs?: Record<string, unknown>;
}

export interface UnitInclude {
  template: string;
  count?: number;
}

export interface UnitInfo {
  name: string;
  path: string;
  usageCount?: number;
  version?: number;
  nodes?: UnitNode[];
  links?: UnitLink[];
  includes?: UnitInclude[];
  module?: string[];
  /** Own-node names this unit exposes as connection points to a parent. */
  ports?: string[];
}

export interface UnitInstance {
  instance: string;
  unit: string;
  version: number;
  currentVersion: number | null;
  exists: boolean;
  outdated: boolean;
  orphaned: boolean;
}

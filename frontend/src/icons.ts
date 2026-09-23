import type { ComponentProps } from "react";
import type { App as ClabUiApp } from "@containerlab/clab-ui";

export type InitialGraphData = NonNullable<ComponentProps<typeof ClabUiApp>["initialData"]>;

export const INITIAL_GRAPH_DATA: InitialGraphData = {
  dockerImages: [],
  customNodes: [],
  customIcons: [],
};

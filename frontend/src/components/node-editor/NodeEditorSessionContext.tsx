import { createContext, useContext } from "react";

const NodeEditorSessionContext = createContext<string | null>(null);

export const NodeEditorSessionProvider = NodeEditorSessionContext.Provider;

export function useNodeEditorSession(): string | null {
  return useContext(NodeEditorSessionContext);
}

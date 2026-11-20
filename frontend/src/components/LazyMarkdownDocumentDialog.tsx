import { lazy, Suspense } from "react";
import type { MarkdownDocumentDialogProps } from "./MarkdownDocumentDialog";

// react-markdown, its remark plugins and highlight.js are a few hundred KB the app does not need until someone opens
// a document, so they load then (a phone on a mobile connection notices).
const Dialog = lazy(() => import("./MarkdownDocumentDialog").then((m) => ({ default: m.MarkdownDocumentDialog })));

export function MarkdownDocumentDialog(props: MarkdownDocumentDialogProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}

/** Lets components deep inside clab-ui (the node editor) open a lab file in
 * an editor tab; the app registers how once. */
type Opener = (path: string) => void;

let opener: Opener | null = null;

export function registerFileOpener(next: Opener | null): void {
  opener = next;
}

export function openLabFile(path: string): boolean {
  if (!opener) return false;
  opener(path);
  return true;
}

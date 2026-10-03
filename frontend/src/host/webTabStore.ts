/** Lets dialogs open a web page (Grafana) as a tab next to the lab tabs; the
 * app registers how once. */
type Opener = (input: { url: string; title: string; subtitle?: string }) => void;

let opener: Opener | null = null;

export function registerWebTabOpener(next: Opener | null): void {
  opener = next;
}

export function openWebTab(input: { url: string; title: string; subtitle?: string }): boolean {
  if (!opener) return false;
  opener(input);
  return true;
}

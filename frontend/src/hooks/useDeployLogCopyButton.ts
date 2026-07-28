import { useEffect } from "react";

/**
 * Injects a "Copy" button into clab-ui's vendored LifecycleProgressModal (the
 * "Deploying lab / Live command output" dialog). That modal ships as built JS
 * in `@srl-labs/clab-ui` with no props or test-ids to hook into, so — following
 * the same DOM-patch approach as usePortalInjection's "Networks" section — we
 * find it by its "Live command output" caption and drop a button into the
 * dialog header that copies the whole log transcript to the clipboard.
 *
 * The modal mounts/unmounts per run, so a body-level MutationObserver re-injects
 * whenever it reappears; the button lives inside the modal DOM and is removed
 * automatically when the modal closes.
 */

const BUTTON_ID = "netlab-deploylog-copy-btn";
const LABEL_TEXT = "Live command output";

export function useDeployLogCopyButton(): void {
  useEffect(() => {
    let scheduled = false;

    const findLabel = (): HTMLElement | null => {
      // Cheap gate: only the deploy modal is a MUI dialog on this surface, so
      // skip the text scan entirely on the (frequent) mutations that fire while
      // no dialog is open.
      const dialog = document.querySelector<HTMLElement>(".MuiDialog-root, [role='dialog']");
      if (!dialog) return null;
      // The caption is a leaf element whose *own* trimmed text is exactly the
      // label — ancestors also contain the (longer) log text, so equality
      // uniquely selects the caption, not a wrapper.
      for (const el of dialog.querySelectorAll<HTMLElement>("span, div, p")) {
        if (el.textContent?.trim() === LABEL_TEXT && el.childElementCount === 0) return el;
      }
      return null;
    };

    const findHeader = (label: HTMLElement): HTMLElement | null => {
      const dialog = label.closest<HTMLElement>(".MuiDialog-paper, [role='dialog']");
      if (!dialog) return null;
      const title = dialog.querySelector<HTMLElement>(".MuiDialogTitle-root");
      if (title) return title;

      for (const el of dialog.querySelectorAll<HTMLElement>("h1, h2, h3, div")) {
        const text = el.textContent?.trim() ?? "";
        if (text.includes("Deploying lab") && !text.includes(LABEL_TEXT)) return el;
      }
      return null;
    };

    const flashCopied = (button: HTMLButtonElement) => {
      const [icon, text] = [button.querySelector(".dl-ico"), button.querySelector(".dl-txt")];
      if (icon) icon.textContent = "✓";
      if (text) text.textContent = "Copied";
      button.style.color = "#4ade80"; // green confirm
      window.setTimeout(() => {
        if (icon) icon.textContent = "⧉";
        if (text) text.textContent = "Copy";
        button.style.color = "";
      }, 1600);
    };

    const inject = () => {
      scheduled = false;
      // Still present and connected? Nothing to do.
      if (document.getElementById(BUTTON_ID)?.isConnected) return;

      const label = findLabel();
      const logBox = label?.nextElementSibling as HTMLElement | null;
      if (!label || !logBox) return;

      const header = findHeader(label);
      if (!header) return;
      if (getComputedStyle(header).position === "static") header.style.position = "relative";
      header.style.paddingRight = `max(${header.style.paddingRight || "0px"}, 92px)`;

      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Copy command output");
      button.style.cssText = [
        "position:absolute",
        "top:14px",
        "right:12px",
        "z-index:2",
        "display:inline-flex",
        "align-items:center",
        "gap:4px",
        "padding:2px 8px",
        "font:inherit",
        "font-size:0.72rem",
        "line-height:1.4",
        "cursor:pointer",
        "color:inherit",
        "background:transparent",
        "border:1px solid rgba(148,163,184,0.35)",
        "border-radius:6px",
        "opacity:0.85",
        "transition:opacity 140ms ease, color 160ms ease",
      ].join(";");
      button.innerHTML = '<span class="dl-ico">⧉</span><span class="dl-txt">Copy</span>';
      button.addEventListener("mouseenter", () => { button.style.opacity = "1"; });
      button.addEventListener("mouseleave", () => { button.style.opacity = "0.85"; });
      button.addEventListener("click", () => {
        // innerText (not textContent) preserves the per-line breaks, since each
        // log line is its own block element inside the scroll container.
        const text = logBox.innerText.replace(/\n{3,}/g, "\n\n").trim();
        void navigator.clipboard.writeText(text).then(
          () => flashCopied(button),
          () => { /* clipboard blocked (insecure origin / permission) — no-op */ },
        );
      });

      header.appendChild(button);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(inject);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.getElementById(BUTTON_ID)?.remove();
    };
  }, []);
}

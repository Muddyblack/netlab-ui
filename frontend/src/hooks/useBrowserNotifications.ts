import { useCallback, useEffect, useState } from "react";

const ENABLED_KEY = "netlab.lifecycleNotifications.enabled";

type ToastSeverity = "success" | "info" | "warning" | "error";

export interface BrowserNotifications {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission | "unavailable";
  toggle: () => Promise<void>;
  notify: (title: string, body: string, tag?: string) => void;
}

/** Opt-in OS notifications for long-running netlab jobs. Permission is only
 * requested from toggle(), which is called by a real navbar click so browsers
 * accept the request as a user gesture. */
export function useBrowserNotifications(
  addToast: (message: string, severity?: ToastSeverity) => void,
): BrowserNotifications {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const readPermission = (): NotificationPermission | "unavailable" =>
    supported ? Notification.permission : "unavailable";
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">(readPermission);
  const [enabled, setEnabled] = useState(
    () => supported && Notification.permission === "granted" && localStorage.getItem(ENABLED_KEY) === "1",
  );

  // Browser site settings can change while this tab is in the background.
  useEffect(() => {
    const sync = () => {
      const next = readPermission();
      setPermission(next);
      if (next !== "granted") setEnabled(false);
    };
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [supported]);

  const toggle = useCallback(async () => {
    if (!supported) {
      addToast("System notifications are not supported by this browser.", "warning");
      return;
    }
    if (enabled) {
      localStorage.removeItem(ENABLED_KEY);
      setEnabled(false);
      addToast("System notifications turned off", "info");
      return;
    }

    let nextPermission = Notification.permission;
    if (nextPermission === "default") {
      try {
        nextPermission = await Notification.requestPermission();
      } catch {
        addToast(
          "The browser could not open notification permissions. Check this site's browser settings.",
          "warning",
        );
        return;
      }
    }
    setPermission(nextPermission);
    if (nextPermission !== "granted") {
      localStorage.removeItem(ENABLED_KEY);
      setEnabled(false);
      addToast(
        nextPermission === "denied"
          ? "Notifications are blocked. Allow them in this site's browser settings."
          : "Notification permission was not granted.",
        "warning",
      );
      return;
    }

    localStorage.setItem(ENABLED_KEY, "1");
    setEnabled(true);
    addToast("System notifications enabled for netlab jobs", "success");
  }, [addToast, enabled, supported]);

  const notify = useCallback((title: string, body: string, tag = "netlab-job") => {
    if (!supported || !enabled || Notification.permission !== "granted") return;
    try {
      const notification = new Notification(title, {
        body,
        // Chromium notifications don't render SVG icons and fall back to the
        // generic browser icon, so point at the raster PNG (like the web app's
        // favicon.png alternate) to get our logo in the notification.
        icon: new URL(`${import.meta.env.BASE_URL}favicon.png`, window.location.origin).href,
        tag,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      window.setTimeout(() => notification.close(), 8000);
    } catch {
      // Some embedded webviews expose Notification but reject construction.
    }
  }, [enabled, supported]);

  return { supported, enabled, permission, toggle, notify };
}

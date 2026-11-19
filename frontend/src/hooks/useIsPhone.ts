import { useEffect, useState } from "react";

/** Below MUI's `sm` breakpoint (600px): a phone, or a very narrow window. */
export const PHONE_QUERY = "(max-width: 599.95px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

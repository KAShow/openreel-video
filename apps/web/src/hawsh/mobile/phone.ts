/**
 * Phone editor (Hawsh Khalifa build, plan mds/plans/2026-10-23-editor-mobile-ui.md): phones only
 * (owner: tablets keep the current layout). On by default since 2026-10-30; `?m=0` switches this
 * browser back to the desktop layout (remembered), `?m=1` undoes that.
 */
import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 600px)";
const FLAG_KEY = "hawsh-mobile-ui";

/** Reads `?m=0` / `?m=1` from the address and remembers it. */
export function mobileUiEnabled(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  try {
    const m = new URLSearchParams(search).get("m");
    if (m === "0") localStorage.setItem(FLAG_KEY, "0");
    if (m === "1") localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) !== "0";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True on a phone-width screen unless this browser switched to the desktop layout. */
export function usePhoneEditor(): boolean {
  const phone = useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  return phone && mobileUiEnabled();
}

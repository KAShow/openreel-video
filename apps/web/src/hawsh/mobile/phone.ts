/**
 * Phone editor (Hawsh Khalifa build, plan mds/plans/2026-10-23-editor-mobile-ui.md). Since 2026-11-17
 * (owner: "the computer should match the phone") it is the editor on every screen, with a wider
 * layout on computers (useWideEditor). `?m=0` switches this browser back to OpenReel's desktop
 * layout (remembered), `?m=1` undoes that.
 */
import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 600px)";
/** Screens where the editor puts the tool sheets beside the preview instead of over it. */
export const WIDE_QUERY = "(min-width: 900px)";
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

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True unless this browser switched back to the desktop layout with `?m=0`. */
export function usePhoneEditor(): boolean {
  return mobileUiEnabled();
}

/** A computer-width screen: same editor, wider arrangement. */
export function useWideEditor(): boolean {
  return useMedia(WIDE_QUERY);
}

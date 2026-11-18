/**
 * Phone viewport (Hawsh build).
 *
 * - No page zoom: pinch gestures inside the app belong to the timeline and the preview, so the browser
 *   must never zoom the page itself. iOS Safari ignores `user-scalable=no`, so a pinch is cancelled at
 *   `gesturestart`, a double tap by `touch-action: manipulation` (index.css), and the zoom a focused
 *   field under 16px causes by `maximum-scale=1` in index.html.
 * - Safari's bottom toolbar covered the editor's tool bar: `100vh` is the height with the toolbar
 *   collapsed. `--app-height` follows `window.innerHeight`, the height that is really visible, as the
 *   toolbar comes and goes (browsers without `dvh`, iOS before 15.4, get the same fix).
 */

export function installViewport(win: Window = window): () => void {
  const doc = win.document;
  const setHeight = () => doc.documentElement.style.setProperty("--app-height", `${win.innerHeight}px`);
  const stopPageZoom = (ev: Event) => ev.preventDefault();

  setHeight();
  win.addEventListener("resize", setHeight);
  win.addEventListener("orientationchange", setHeight);
  win.visualViewport?.addEventListener("resize", setHeight);
  doc.addEventListener("gesturestart", stopPageZoom);
  doc.addEventListener("gesturechange", stopPageZoom);
  return () => {
    win.removeEventListener("resize", setHeight);
    win.removeEventListener("orientationchange", setHeight);
    win.visualViewport?.removeEventListener("resize", setHeight);
    doc.removeEventListener("gesturestart", stopPageZoom);
    doc.removeEventListener("gesturechange", stopPageZoom);
  };
}

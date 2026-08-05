/**
 * instant-overlay.ts
 *
 * A dependency-free "opening…" overlay, painted synchronously on the click that opens the
 * configurator.
 *
 * WHY THIS EXISTS: the modal's own loading shell is a React component, so it cannot appear until
 * the ~222KB modal bundle has downloaded AND parsed. On a product page still loading — where a
 * dozen third-party apps are competing for the main thread — that parse is exactly what gets
 * starved, so a click during page load produced no visible response for a second or more while
 * every later click felt instant. The shopper is told nothing during the one window where the
 * wait is longest.
 *
 * This is plain DOM with inline styles: no React, no bundle, no stylesheet, nothing to fetch. It
 * paints in the same frame as the click regardless of what else the page is doing, and the React
 * modal replaces it the moment it mounts.
 */

const OVERLAY_ID = "proto-instant-overlay";

/** Matches the React shell's backdrop + panel so the handover is not a visible jump. */
function buildOverlay(): HTMLElement {
  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-label", "Opening the configurator");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    // One below the React modal's z-index, so when that mounts it covers this even for the frame
    // before removal — no flicker of two stacked dialogs.
    "z-index:2147483646",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "background:rgba(0,0,0,0.5)",
    "backdrop-filter:blur(12px)",
    "-webkit-backdrop-filter:blur(12px)",
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:14px",
    "background:#fff",
    "border-radius:10px",
    "padding:40px 56px",
    "box-shadow:0 25px 50px -12px rgba(0,0,0,0.25)",
    "font-family:system-ui,-apple-system,sans-serif",
  ].join(";");

  const spinner = document.createElement("div");
  spinner.style.cssText = [
    "width:32px",
    "height:32px",
    "border-radius:50%",
    "border:2px solid #e5e5e5",
    "border-top-color:#262626",
    // Keyframes are defined inline below — the modal stylesheet ships with the bundle we are
    // waiting on, so this cannot rely on any class from it.
    "animation:proto-instant-spin 0.7s linear infinite",
  ].join(";");

  const label = document.createElement("p");
  label.textContent = "Loading your stringing options…";
  label.style.cssText = "margin:0;font-size:13px;color:#737373;";

  const style = document.createElement("style");
  style.textContent =
    "@keyframes proto-instant-spin{to{transform:rotate(360deg)}}" +
    "@media (prefers-reduced-motion:reduce){#" +
    OVERLAY_ID +
    " [data-spin]{animation-duration:2s}}";

  spinner.setAttribute("data-spin", "");
  panel.appendChild(spinner);
  panel.appendChild(label);
  root.appendChild(style);
  root.appendChild(panel);
  return root;
}

/**
 * Paint the overlay now. Idempotent — a second click while one is showing is a no-op rather than
 * stacking a second backdrop.
 *
 * @param onDismiss Called if the shopper clicks the backdrop. Without this a failed open would
 *   trap them behind a spinner with no way out, which is worse than the slow load it replaces.
 */
export function showInstantOverlay(onDismiss?: () => void): void {
  if (document.getElementById(OVERLAY_ID)) return;
  const overlay = buildOverlay();
  overlay.addEventListener("click", (event) => {
    // Backdrop only — clicks on the panel itself should not dismiss.
    if (event.target !== overlay) return;
    hideInstantOverlay();
    onDismiss?.();
  });
  document.body.appendChild(overlay);
}

/** Remove the overlay. Safe to call when none is showing. */
export function hideInstantOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

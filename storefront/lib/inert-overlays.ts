/**
 * inert-overlays.ts
 *
 * Third-party promo widgets (notably Alia) sometimes leave an EMPTY full-viewport
 * `position:fixed; inset:0; z-index:2147483647` dialog in the DOM after their popup
 * fails to render or is dismissed incorrectly. That shell still has pointer-events
 * and sits above everything — Configure looks fine but every click hits the overlay.
 *
 * We only neutralize shells that are clearly inert (no children). Real popups with
 * content are left alone.
 */

const MARK = "data-proto-inert-overlay";

function isFullViewportShell(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.position !== "fixed" && cs.position !== "absolute") return false;
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  // Cover most of the viewport (promo backdrops are inset:0).
  return (
    r.width >= window.innerWidth * 0.9 &&
    r.height >= window.innerHeight * 0.9 &&
    r.top <= 8 &&
    r.left <= 8
  );
}

function looksLikePromoShell(el: HTMLElement): boolean {
  if (el.id?.startsWith("alia-root")) return true;
  if (el.getAttribute("role") === "dialog" && el.getAttribute("aria-modal") === "true") {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("promotional") || label.includes("popup") || label.includes("promo")) {
      return true;
    }
  }
  return false;
}

/** Disable pointer events on empty full-screen promo shells that would steal Configure clicks. */
export function neutralizeInertOverlays(): void {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[id^="alia-root"], [role="dialog"][aria-modal="true"]',
  );

  for (const el of candidates) {
    if (el.closest("#proto-configurator-root, .proto-v2-standalone-wrapper")) continue;
    if (el.childElementCount > 0) continue;
    if (!looksLikePromoShell(el) && !el.id?.startsWith("alia-root")) continue;
    if (!isFullViewportShell(el)) continue;
    if (el.getAttribute(MARK) === "1") continue;

    el.style.setProperty("pointer-events", "none", "important");
    el.setAttribute(MARK, "1");
    // Keep it out of the accessibility tree so screen readers don't announce an empty dialog.
    el.setAttribute("aria-hidden", "true");
  }
}

let overlayObserver: MutationObserver | null = null;

/** Watch for late-injected empty promo shells (Alia mounts after first paint). */
export function watchInertOverlays(): void {
  neutralizeInertOverlays();
  if (overlayObserver || typeof MutationObserver === "undefined") return;

  let queued = false;
  overlayObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      neutralizeInertOverlays();
    });
  });
  overlayObserver.observe(document.documentElement, { childList: true, subtree: true });
}

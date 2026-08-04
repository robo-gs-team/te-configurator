/**
 * inert-overlays.ts
 *
 * Third-party promo widgets (notably Alia) sometimes leave an EMPTY full-viewport
 * `position:fixed; inset:0; z-index:2147483647` dialog in the DOM after their popup
 * fails to render or is dismissed incorrectly. That shell still has pointer-events
 * and sits above everything — Configure looks fine but every click hits the overlay.
 *
 * Alia may also RESET the inline style after we neutralize it. We therefore re-apply
 * on every pass (and observe style attribute mutations), not just the first time.
 *
 * We only neutralize shells that are clearly inert (no meaningful children). Real
 * popups with content are left alone.
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

/** True when the dialog has no real UI — empty or only whitespace/comment nodes. */
function isEffectivelyEmpty(el: HTMLElement): boolean {
  if (el.childElementCount === 0) return true;
  // Some widgets mount a single empty wrapper child before content arrives.
  if (el.childElementCount === 1) {
    const child = el.firstElementChild as HTMLElement | null;
    if (child && child.childElementCount === 0 && !(child.textContent || "").trim()) {
      return true;
    }
  }
  return !(el.textContent || "").trim() && el.querySelectorAll("img, iframe, button, a, input").length === 0;
}

function applyInert(el: HTMLElement): void {
  // Always re-apply — Alia often rewrites the whole style="" attribute and wipes pe:none.
  el.style.setProperty("pointer-events", "none", "important");
  el.setAttribute(MARK, "1");
  el.setAttribute("aria-hidden", "true");
}

/** Disable pointer events on empty full-screen promo shells that would steal Configure clicks. */
export function neutralizeInertOverlays(): void {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[id^="alia-root"], [role="dialog"][aria-modal="true"]',
  );

  for (const el of candidates) {
    if (el.closest("#proto-configurator-root, .proto-v2-standalone-wrapper")) continue;
    if (!looksLikePromoShell(el) && !el.id?.startsWith("alia-root")) continue;
    if (!isEffectivelyEmpty(el)) continue;
    if (!isFullViewportShell(el)) continue;
    applyInert(el);
  }
}

let overlayObserver: MutationObserver | null = null;
let keepAliveTimer: number | null = null;

/** Watch for late-injected / style-reset empty promo shells (Alia mounts and rewrites styles). */
export function watchInertOverlays(): void {
  neutralizeInertOverlays();
  if (typeof MutationObserver === "undefined") return;

  if (!overlayObserver) {
    let queued = false;
    overlayObserver = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        neutralizeInertOverlays();
      });
    });
    // childList: new alia roots; attributes: Alia rewriting style / wiping pe:none.
    overlayObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
    });
  }

  // Belt-and-braces: Alia sometimes mutates styles in ways that coalesce poorly with rAF.
  // Re-assert for a short window after boot / Strung changes.
  if (keepAliveTimer == null) {
    let ticks = 0;
    keepAliveTimer = window.setInterval(() => {
      neutralizeInertOverlays();
      ticks += 1;
      if (ticks >= 20) {
        // ~10s at 500ms — enough for late promo mounts; observer covers the rest.
        if (keepAliveTimer != null) {
          window.clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
      }
    }, 500);
  }
}

/** Re-arm the short keep-alive window (call on Strung selection / Configure show). */
export function rearmInertOverlayWatch(): void {
  if (keepAliveTimer != null) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  watchInertOverlays();
}

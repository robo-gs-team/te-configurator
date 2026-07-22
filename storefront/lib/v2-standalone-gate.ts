/**
 * v2-standalone-gate.ts
 *
 * Purely additive, read-only visibility for the v2 standalone "Configure Racquet" button:
 * shows it only when the shopper has the page's real Strung/Unstrung control set to "Strung" —
 * stringing this app configures doesn't apply to an unstrung racquet, so the button shouldn't
 * appear for that choice.
 *
 * Deliberately NOT the old stringing-page-gate: this never touches the legacy configurator, the
 * theme's buy box, or the native Add to Cart, and it never writes to the control it reads — it
 * only ever toggles a class on our OWN wrapper. Safe to run alongside anything else on the page.
 */

const TRIGGER = "strung";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Find the page's Strung/Unstrung control by vocabulary (any <select> whose options include
 * both "strung" and "unstrung"), not by a specific selector — this app doesn't own that control,
 * it belongs to the merchant's existing configurator or theme, and its markup can vary.
 */
function findStringingSelect(): HTMLSelectElement | null {
  const selects = document.querySelectorAll<HTMLSelectElement>("select");
  for (const select of selects) {
    if (select.closest("[data-proto-v2-standalone]")) continue;
    const values = Array.from(select.options).map((o) =>
      normalize(o.value || o.textContent || ""),
    );
    if (values.includes("strung") && values.includes("unstrung")) return select;
  }
  return null;
}

/** Show/hide every v2 standalone wrapper based on the given select's current value. */
function applyVisibility(select: HTMLSelectElement | null) {
  const show = select ? normalize(select.value) === TRIGGER : true;
  document.querySelectorAll<HTMLElement>(".proto-v2-standalone-wrapper").forEach((wrapper) => {
    wrapper.classList.toggle("proto-v2-hide-unstrung", !show);
  });
}

let boundSelect: HTMLSelectElement | null = null;

/**
 * Initialize (or re-initialize) the visibility gate. Safe to call repeatedly — e.g. on
 * `shopify:section:load` — since it re-finds the control and re-binds only if it changed.
 */
export function initV2StandaloneGate() {
  const select = findStringingSelect();
  applyVisibility(select);

  if (select === boundSelect) return;
  boundSelect = select;
  if (select && !select.dataset.protoV2GateBound) {
    select.dataset.protoV2GateBound = "true";
    select.addEventListener("change", () => applyVisibility(select));
  }
}

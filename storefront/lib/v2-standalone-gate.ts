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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Does this option value/label belong to the stringing choice? Identified by the distinctive word
 * "unstrung" — a control that offers an "unstrung" option is unambiguously the Strung/Unstrung
 * picker. NOTE: "unstrung" CONTAINS "strung", so anything testing for "strung" must exclude the
 * "unstrung" case first (see classifyStringing).
 */
function looksUnstrung(value: string, text: string): boolean {
  return value.includes("unstrung") || text.includes("unstrung");
}

/**
 * Classify a selected option as "strung" vs "unstrung". We deliberately do NOT require the strung
 * choice to be labelled literally "Strung": stores spell it many ways ("Factory Strung", "Strung —
 * add $20", "Custom string job", or even a bare variant id) — requiring an exact "strung" match was
 * why the control went unrecognized and the button never gated. Within a control that HAS an
 * unstrung option, anything that isn't the unstrung option is treated as strung → button shows.
 */
function classifyStringing(value: string, text: string): "strung" | "unstrung" {
  return looksUnstrung(value, text) ? "unstrung" : "strung";
}

/**
 * In the Shopify Theme Editor the App Proxy round-trip that gates this button doesn't run, and
 * there may be no real Strung/Unstrung variant to select — so gating on it would leave the button
 * permanently hidden while the merchant is trying to place/style it. In the editor we always show.
 */
function isThemeEditor(): boolean {
  return Boolean(
    (window as unknown as { Shopify?: { designMode?: boolean } }).Shopify?.designMode,
  );
}

/** The theme's add-to-cart form, when present — the preferred scan root (avoids unrelated selects). */
function findProductForm(): ParentNode | null {
  return (
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]') ??
    null
  );
}

/**
 * Read the shopper's current Strung/Unstrung choice from the page's REAL variant control,
 * identified by vocabulary (its options include both "strung" and "unstrung"), never a fragile
 * selector — the control belongs to the theme, not us. Handles the shapes themes actually use:
 *
 *   - <select> of variant options — the currently-selected option's VALUE may be the label
 *     ("Strung") OR a variant id ("49123…"); we check both value and the option's text. (Reading
 *     select.value alone was the bug: a variant-id-valued picker never matched "strung", so the
 *     control wasn't even recognized and the button never gated.)
 *   - radio-button variant picker — read the checked radio's value, falling back to its label.
 *
 * Our own button subtree is always skipped. @returns "strung" | "unstrung", or null if no such
 * control exists on the page (caller then defaults to showing the button).
 */
function readStringingValue(root: ParentNode): string | null {
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("select"))) {
    if (select.closest("[data-proto-v2-standalone]")) continue;
    const opts = Array.from(select.options).map((o) => ({
      value: normalize(o.value || ""),
      text: normalize(o.textContent || ""),
    }));
    // Recognize the control by the presence of an "unstrung" option (see looksUnstrung).
    if (!opts.some((o) => looksUnstrung(o.value, o.text))) continue;

    const opt = select.selectedOptions[0] ?? select.options[select.selectedIndex];
    if (!opt) continue;
    return classifyStringing(normalize(opt.value), normalize(opt.textContent || ""));
  }

  // Radio-button variant picker: group by name, find the stringing group, read the checked one.
  const radios = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((r) => !r.closest("[data-proto-v2-standalone]"));
  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of radios) {
    const list = groups.get(radio.name) ?? [];
    list.push(radio);
    groups.set(radio.name, list);
  }
  for (const group of groups.values()) {
    // value + label text for each radio (themes sometimes set the value to a variant id, so the
    // human-readable choice lives in the associated <label>).
    const readable = (r: HTMLInputElement): { value: string; text: string } => {
      const label = r.id
        ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`)
        : r.closest("label");
      return { value: normalize(r.value), text: normalize(label?.textContent || "") };
    };
    const cells = group.map(readable);
    if (!cells.some((c) => looksUnstrung(c.value, c.text))) continue;
    const checkedIndex = group.findIndex((r) => r.checked);
    if (checkedIndex >= 0) {
      const c = cells[checkedIndex];
      return classifyStringing(c.value, c.text);
    }
  }

  return null;
}

/** The shopper's stringing choice, scanning the cart form first then the whole document. */
function getStringingValue(): string | null {
  const form = findProductForm();
  if (form) {
    const inForm = readStringingValue(form);
    if (inForm) return inForm;
  }
  return readStringingValue(document);
}

/** Show/hide every v2 standalone wrapper based on the current Strung/Unstrung choice. */
function applyVisibility() {
  const value = getStringingValue();
  // Show when: in the theme editor (always, for placement), no stringing control found (nothing
  // to gate on), or the choice is "strung". Hide only on a definite "unstrung".
  const show = isThemeEditor() || value === null || value === "strung";
  document.querySelectorAll<HTMLElement>(".proto-v2-standalone-wrapper").forEach((wrapper) => {
    wrapper.classList.toggle("proto-v2-hide-unstrung", !show);
  });
}

let delegatedChangeBound = false;

/**
 * The stringing control can appear in the DOM AFTER this gate first runs: many themes hydrate or
 * re-render the variant/property pickers with JS a beat after first paint. Since the split-phase
 * linkage fetch, the button is revealed very early (tiny/cached linkage answer), so the gate's
 * first scan can land before that control exists — it then finds nothing to gate on, shows the
 * button, and (for a pre-selected "Unstrung") never re-checks, because no `change` event fires.
 * Re-running the scan across a short window catches the late-rendering control. Every pass is
 * read-only and idempotent, so extra runs are harmless.
 */
function scheduleRescans() {
  for (const delay of [50, 150, 400, 900, 1800]) {
    window.setTimeout(applyVisibility, delay);
  }
  window.addEventListener("load", applyVisibility, { once: true });
}

/**
 * Initialize (or re-initialize) the visibility gate. Safe to call repeatedly — e.g. on
 * `shopify:section:load`. Uses ONE delegated, capturing `change` listener on the document rather
 * than binding to a specific control: the stringing control can be a <select> or a radio group,
 * can be re-rendered by the theme on variant change, and can live outside any form — a delegated
 * listener catches all of those without re-finding and re-binding the exact element each time.
 */
export function initV2StandaloneGate() {
  applyVisibility();
  if (!delegatedChangeBound) {
    delegatedChangeBound = true;
    document.addEventListener("change", applyVisibility, true);
    scheduleRescans();
  }
}

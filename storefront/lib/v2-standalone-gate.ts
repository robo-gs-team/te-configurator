/**
 * v2-standalone-gate.ts
 *
 * Visibility + ATC-slot placement for the v2 standalone "Configure Racquet" (gear) button:
 * shows it when the shopper has the page's real Strung/Unstrung control set to "Strung" —
 * and when shown, moves that gear button into the theme Add-to-Cart slot so it replaces the
 * plain Configure / ATC beside quantity. On Unstrung it hides and restores the theme buy button.
 *
 * Never writes to the Strung/Unstrung control it reads (except ensureStringingIsStrung on click).
 * Safe alongside the theme's own picker.
 */

import {
  syncStandaloneConfigureSlot,
} from "./configure-placement";

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

/**
 * If the page stringing control is currently Unstrung, switch it to Strung so Configure can
 * proceed. Returns true when a change was made (caller may want to wait a tick for theme JS).
 */
export function ensureStringingIsStrung(): boolean {
  const form =
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]');
  const roots: ParentNode[] = form ? [form, document] : [document];

  for (const root of roots) {
    for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("select"))) {
      if (select.closest("[data-proto-v2-standalone]")) continue;
      const opts = Array.from(select.options);
      const hasUnstrung = opts.some((o) =>
        looksUnstrung(normalize(o.value), normalize(o.textContent || "")),
      );
      if (!hasUnstrung) continue;

      const current = select.selectedOptions[0] ?? select.options[select.selectedIndex];
      if (
        current &&
        looksUnstrung(normalize(current.value), normalize(current.textContent || ""))
      ) {
        const strung = opts.find(
          (o) => !looksUnstrung(normalize(o.value), normalize(o.textContent || "")),
        );
        if (!strung) return false;
        select.value = strung.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }
  }
  return false;
}

/** Show Configure below the stringing dropdown when Strung; hide it when Unstrung. */
function applyVisibility() {
  // Skip class + slot updates while Configure is opening — relocating the button mid-open races
  // the click handler and can drop the modal open / loading feedback (see data-proto-configuring
  // in entry.tsx openConfigurator).
  if (document.documentElement.hasAttribute("data-proto-configuring")) return;

  const value = getStringingValue();
  // Strung (or no stringing control) → show Configure above quantity/ATC. Unstrung → hide it.
  const showConfigure = value === null || value === "strung";
  const hideOnUnstrung = value === "unstrung";
  document.querySelectorAll<HTMLElement>(".proto-v2-standalone-wrapper").forEach((wrapper) => {
    wrapper.classList.toggle("proto-v2-hide-unstrung", hideOnUnstrung);
  });
  syncStandaloneConfigureSlot(showConfigure);
}

let delegatedChangeBound = false;
let domObserver: MutationObserver | null = null;

/**
 * The stringing control can appear in (or be re-rendered into) the DOM well AFTER this gate first
 * runs: many themes hydrate or re-render variant/property pickers with JS a beat after first
 * paint. Since the split-phase linkage fetch, our button is revealed very early (tiny/cached
 * linkage answer), so the gate's first scan can land before that control exists — it then finds
 * nothing to gate on, shows the button, and for a PRE-SELECTED "Unstrung" never re-checks, because
 * no `change` event ever fires.
 *
 * A MutationObserver is the reliable fix rather than a fixed set of timers: it catches the control
 * whenever it appears, no matter how late (slow network, heavy theme, a re-render seconds in), and
 * it re-applies the gate if the theme rebuilds the buy box underneath us. The short timer ladder is
 * kept purely as a cheap belt-and-braces for environments where the observer is unavailable. Every
 * pass is idempotent, so extra runs are harmless.
 */
function watchForLateRenders() {
  for (const delay of [50, 150, 400, 900, 1800]) {
    window.setTimeout(applyVisibility, delay);
  }
  window.addEventListener("load", applyVisibility, { once: true });

  if (typeof MutationObserver === "undefined" || domObserver) return;
  let queued = false;
  domObserver = new MutationObserver(() => {
    // Coalesce bursts (a theme re-render fires many records) into ONE pass per frame — and run it
    // off the observer callback so our own DOM writes can't re-enter it synchronously.
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      applyVisibility();
    });
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
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
    watchForLateRenders();
  }
}

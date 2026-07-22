/**
 * stringing-page-gate.ts
 *
 * The orchestrator for the Strung/Unstrung "gate" on the product page. It ties together the
 * dropdown, the Configure button's visibility, the button's placement in the buy box, and the
 * hiding of the theme's native buy buttons.
 *
 * Core idea: a single piece of state — `<html data-proto-stringing-state="strung|unstrung">`
 * — derived from the dropdown value, drives everything:
 *   - "strung"   → show Configure (moved into the buy box), hide the theme's Buy now buttons.
 *   - "unstrung" → hide Configure, restore the theme's native buy buttons.
 *
 * `applyStringingPageGate` is the function that reads the dropdown and applies all of the
 * above. `initStringingPageGate` wires up the listeners that call it (dropdown change,
 * pageshow, section reloads). Note: the Liquid block ships its OWN inline copy of this gate
 * logic so it works before this bundle loads; the two can briefly disagree until the bundle
 * takes over — part of the known fragility.
 */

import {
  getConfiguratorActions,
  restoreAddToCartButtons,
  syncConfigureButtonSlot,
} from "./configure-placement";
import { findThemeStringingBlock } from "./theme-placement";
import { refreshThemeBuyBoxHidden, setThemeBuyBoxHidden } from "./theme-buybox";
import { refreshLegacyConfiguratorHidden } from "./legacy-configurator";

/** Default dropdown value that means "show the configurator", used when none is configured. */
const DEFAULT_TRIGGER = "Strung";

/** Lower-case + trim a value for case-insensitive comparison of dropdown values. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Get the dropdown value that should reveal the configurator for a given gate wrapper.
 * Reads the wrapper's `data-trigger-value`, falling back to "Strung".
 * @param wrapper The gate wrapper (optional).
 * @returns The trigger value string.
 */
export function getStringingTriggerValue(wrapper?: HTMLElement | null): string {
  return wrapper?.dataset.triggerValue?.trim() || DEFAULT_TRIGGER;
}

/**
 * Find the dropdown `<select>` whose value drives the gate.
 *
 * Resolution order: the app's own `[data-proto-stringing-select]` inside the wrapper; then a
 * theme stringing block's native `<select>` (when we're syncing to a theme field rather than
 * rendering our own); then any app select on the page.
 * @param wrapper The gate wrapper (optional).
 * @returns The active select element, or null if none exists.
 */
export function getActiveStringingSelect(
  wrapper?: HTMLElement | null,
): HTMLSelectElement | null {
  const protoSelect = wrapper?.querySelector<HTMLSelectElement>(
    "[data-proto-stringing-select]",
  );
  if (protoSelect) return protoSelect;

  const themeBlock = findThemeStringingBlock();
  if (themeBlock && !themeBlock.closest(".proto-configurator-button-wrapper")) {
    return themeBlock.querySelector<HTMLSelectElement>("select");
  }

  return document.querySelector<HTMLSelectElement>("[data-proto-stringing-select]");
}

/**
 * @param value The current dropdown value.
 * @param trigger The value that means "strung" (defaults to "Strung").
 * @returns true if the selection equals the trigger (case-insensitive) → configurator shown.
 */
export function isStrungSelection(
  value: string,
  trigger = DEFAULT_TRIGGER,
): boolean {
  return normalize(value) === normalize(trigger);
}

/**
 * Build the set of stringing option values ("strung", "unstrung", …) that identify a control as
 * "the stringing selector". Derived from the gate's trigger value plus the app dropdown's own
 * option list — so it always matches the exact vocabulary this merchant configured, no hardcoding.
 */
function getStringingVocabulary(wrapper?: HTMLElement | null): Set<string> {
  const vocab = new Set<string>();
  vocab.add(normalize(getStringingTriggerValue(wrapper)));

  const appSelect =
    wrapper?.querySelector<HTMLSelectElement>("[data-proto-stringing-select]") ??
    document.querySelector<HTMLSelectElement>("[data-proto-stringing-select]");
  appSelect?.querySelectorAll("option").forEach((opt) => {
    const value = normalize(opt.value || opt.textContent || "");
    if (value) vocab.add(value);
  });

  return vocab;
}

/** The product form that carries the theme's real variant controls, when it has them. */
function findProductForm(): ParentNode | null {
  return (
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]') ??
    null
  );
}

/**
 * Scan `root` for a Strung/Unstrung control (a `<select>` of variant options, or a radio group)
 * identified by vocabulary, and return its current normalized value.
 * @returns The normalized current value, or null if no matching control was found in `root`.
 */
function scanRootForStringingValue(root: ParentNode, vocab: Set<string>): string | null {
  // 1) Native <select> of variant options (Dawn-style variant picker, or the theme's own field).
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("select"))) {
    if (select.closest(".proto-configurator-button-wrapper")) continue;
    if (select.matches("[data-proto-stringing-select]")) continue;
    const optionValues = Array.from(select.options).map((o) =>
      normalize(o.value || o.textContent || ""),
    );
    if (!optionValues.some((v) => vocab.has(v))) continue;
    const current = normalize(
      select.value || select.selectedOptions[0]?.textContent || "",
    );
    if (vocab.has(current)) return current;
  }

  // 2) Radio-button variant picker: group radios by name, find the group whose values are the
  //    stringing vocabulary, and read the checked one.
  const radios = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((r) => !r.closest(".proto-configurator-button-wrapper"));
  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of radios) {
    const list = groups.get(radio.name) ?? [];
    list.push(radio);
    groups.set(radio.name, list);
  }
  for (const group of groups.values()) {
    if (!group.some((r) => vocab.has(normalize(r.value)))) continue;
    const checked = group.find((r) => r.checked);
    if (checked) {
      const value = normalize(checked.value);
      if (vocab.has(value)) return value;
    }
  }

  return null;
}

/**
 * Read the shopper's ACTUAL Strung/Unstrung choice from the theme's real variant control, rather
 * than the app's own decorative dropdown.
 *
 * The Strung/Unstrung choice is a real Shopify variant, so the theme renders a native control for
 * it (a `<select>` of variant options, or a radio group). We locate that control WITHOUT relying
 * on fragile label text: any control whose option values include this configurator's stringing
 * vocabulary (e.g. "strung"/"unstrung") IS the stringing control. We then read its current value.
 * The app's own `[data-proto-stringing-select]` is deliberately skipped so we never read it here.
 *
 * Scoped to the add-to-cart form FIRST (avoids matching unrelated selects elsewhere on the page),
 * then widened to the whole document — some themes (this app has previously had to special-case
 * "Vision and similar themes", see theme-placement.ts) render their native stringing field
 * completely outside the cart form, so a form-only scan silently misses it.
 *
 * @returns The normalized current stringing value ("strung"/"unstrung"), or null if no real
 *   variant control was found anywhere on the page (in which case the caller falls back to the
 *   app dropdown).
 */
function getRealVariantStringingValue(wrapper?: HTMLElement | null): string | null {
  const vocab = getStringingVocabulary(wrapper);
  if (vocab.size === 0) return null;

  const form = findProductForm();
  if (form) {
    const inForm = scanRootForStringingValue(form, vocab);
    if (inForm) return inForm;
  }

  return scanRootForStringingValue(document, vocab);
}

/**
 * @returns true unless the wrapper explicitly opts out via `data-hide-theme-buybox="false"`.
 *   Controls whether selecting "Strung" also hides the theme's Buy now buttons.
 */
function shouldHideThemeBuyBox(wrapper: HTMLElement): boolean {
  return wrapper.dataset.hideThemeBuybox !== "false";
}

/**
 * Apply the gate to the page: read the dropdown, set the global strung/unstrung state, and
 * show/hide + relocate the Configure button and the theme's buy buttons accordingly.
 *
 * Operates on a single wrapper if passed one, otherwise on every gate wrapper on the page.
 * If there are no gates at all, it clears the global state and returns. The strung/unstrung
 * decision uses the FIRST wrapper's dropdown; that state is written to
 * `<html data-proto-stringing-state>` and then each wrapper's actions are toggled, the
 * Configure button is moved into/out of the buy box, and (when not opted out) the theme buy
 * box is hidden for strung / restored for unstrung.
 *
 * @param wrapper Optional single wrapper to apply to; omit to apply to all gates.
 */
export function applyStringingPageGate(wrapper?: HTMLElement) {
  const wrappers = wrapper
    ? [wrapper]
    : Array.from(
        document.querySelectorAll<HTMLElement>("[data-proto-stringing-gate]"),
      );

  if (wrappers.length === 0 && !findThemeStringingBlock()) {
    delete document.documentElement.dataset.protoStringingState;
    return;
  }

  const primary = wrappers[0];
  const trigger = getStringingTriggerValue(primary);

  // The shopper's REAL variant choice (Strung/Unstrung is a Shopify variant) is authoritative.
  // Only fall back to the app's own decorative dropdown when no real variant control exists —
  // that dropdown defaults to "Strung" and does NOT reflect the selected variant, which is
  // exactly what used to leave Configure showing on an Unstrung racquet.
  const realValue = getRealVariantStringingValue(primary);
  const value = realValue ?? getActiveStringingSelect(primary)?.value ?? null;
  const showConfigure = value != null ? isStrungSelection(value, trigger) : true;

  document.documentElement.dataset.protoStringingState = showConfigure
    ? "strung"
    : "unstrung";

  // The legacy Liquid configurator's own script re-shows itself on "Strung" (its original
  // behaviour, predating this app) by setting its own inline style — which clobbers our earlier
  // hide rather than merely fighting it. Re-assert the hide on every gate application (i.e. every
  // Strung/Unstrung change), not just once at page load. Only for products this app actually
  // owns (`proto-configurator-linked`) — never touches a page this app isn't assigned to.
  if (showConfigure && document.documentElement.classList.contains("proto-configurator-linked")) {
    refreshLegacyConfiguratorHidden();
  }

  for (const gateWrapper of wrappers) {
    const actions = getConfiguratorActions(gateWrapper);
    if (!actions) continue;

    actions.hidden = !showConfigure;
    actions.setAttribute("aria-hidden", showConfigure ? "false" : "true");

    if (!showConfigure) {
      actions.classList.remove("proto-configurator-actions--inline");
      actions.style.removeProperty("display");
      // A prior failed-fetch error banner (showConfigureError) is appended as a sibling of
      // `actions` inside the wrapper, so hiding `actions` alone doesn't hide it — it would
      // otherwise linger visibly under a hidden/absent button after switching to Unstrung.
      gateWrapper.querySelector("[data-proto-configure-error]")?.remove();
    }

    syncConfigureButtonSlot(gateWrapper, showConfigure);

    if (shouldHideThemeBuyBox(gateWrapper)) {
      if (showConfigure) {
        refreshThemeBuyBoxHidden(true);
      } else {
        setThemeBuyBoxHidden(false);
        restoreAddToCartButtons();
      }
    } else if (!showConfigure) {
      restoreAddToCartButtons();
    }
  }

  if (!showConfigure) {
    setThemeBuyBoxHidden(false);
    restoreAddToCartButtons();
  }
}

/** Guards the one-time window-level listener binding (pageshow) so it's attached only once. */
let gateListenersBound = false;

/**
 * Bind a `change` listener to a dropdown so changing it re-applies the gate. Idempotent —
 * marks the select with `data-proto-stringing-gate-bound` so it's never double-bound.
 */
function bindStringingSelect(select: HTMLSelectElement) {
  if (select.dataset.protoStringingGateBound) return;
  select.dataset.protoStringingGateBound = "true";
  select.addEventListener("change", () => applyStringingPageGate());
}

/**
 * Initialize the gate system: assign ids, bind dropdown listeners, sync with a theme stringing
 * select if present, attach a one-time pageshow listener, and apply the gate once immediately.
 *
 * Safe to call multiple times (on boot, on `shopify:section:load`, etc.) — each step is
 * idempotent. For each gate wrapper it ensures a stable `data-proto-stringing-gate-id` (shared
 * with its actions element so placement can re-find the actions after they're moved), and
 * binds the app's own dropdown. If the page instead uses a theme stringing `<select>`, it
 * binds that and mirrors its value into our select on change.
 */
export function initStringingPageGate() {
  document.querySelectorAll<HTMLElement>("[data-proto-stringing-gate]").forEach(
    (wrapper) => {
      if (!wrapper.dataset.protoStringingGateId) {
        wrapper.dataset.protoStringingGateId = `gate-${Math.random().toString(36).slice(2, 9)}`;
      }

      const actions = wrapper.querySelector<HTMLElement>(
        "[data-proto-configurator-actions]",
      );
      if (actions && !actions.dataset.protoStringingGateId) {
        actions.dataset.protoStringingGateId = wrapper.dataset.protoStringingGateId;
      }

      const protoSelect = wrapper.querySelector<HTMLSelectElement>(
        "[data-proto-stringing-select]",
      );
      if (protoSelect) bindStringingSelect(protoSelect);
    },
  );

  const themeBlock = findThemeStringingBlock();
  const themeSelect = themeBlock?.querySelector<HTMLSelectElement>("select");
  if (themeSelect && !themeBlock?.closest(".proto-configurator-button-wrapper")) {
    if (!themeSelect.dataset.protoStringingThemeSync) {
      themeSelect.dataset.protoStringingThemeSync = "true";
      themeSelect.addEventListener("change", () => {
        const protoSelect = document.querySelector<HTMLSelectElement>(
          "[data-proto-stringing-select]",
        );
        if (protoSelect && protoSelect !== themeSelect) {
          protoSelect.value = themeSelect.value;
        }
        applyStringingPageGate();
      });
    }
  }

  if (!gateListenersBound) {
    gateListenersBound = true;
    window.addEventListener("pageshow", () => applyStringingPageGate());
    // Selecting the real Strung/Unstrung variant fires a `change` on the theme's variant control
    // (a native <select> or radio), which is NOT our own dropdown, so the per-select bindings
    // above never see it. Re-apply the gate on ANY change in the product area — applyStringingPageGate
    // reads the real variant itself and is cheap/idempotent, so this reliably tracks variant changes
    // even on themes whose markup our per-control bindings don't recognise.
    document.addEventListener("change", () => applyStringingPageGate());
  }

  applyStringingPageGate();
}

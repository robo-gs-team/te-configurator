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
 * @returns true if a stringing gate exists on the page — either our own gate wrapper or a
 *   detected theme stringing block.
 */
export function hasStringingGate(): boolean {
  return (
    document.querySelector("[data-proto-stringing-gate]") !== null ||
    findThemeStringingBlock() !== null
  );
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
  const select = getActiveStringingSelect(primary);
  const trigger = getStringingTriggerValue(primary);
  const showConfigure = select
    ? isStrungSelection(select.value, trigger)
    : true;

  document.documentElement.dataset.protoStringingState = showConfigure
    ? "strung"
    : "unstrung";

  for (const gateWrapper of wrappers) {
    const actions = getConfiguratorActions(gateWrapper);
    if (!actions) continue;

    actions.hidden = !showConfigure;
    actions.setAttribute("aria-hidden", showConfigure ? "false" : "true");

    if (!showConfigure) {
      actions.classList.remove("proto-configurator-actions--inline");
      actions.style.removeProperty("display");
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
  }

  applyStringingPageGate();
}

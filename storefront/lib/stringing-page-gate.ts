import {
  getConfiguratorActions,
  restoreAddToCartButtons,
  syncConfigureButtonSlot,
} from "./configure-placement";
import { findThemeStringingBlock } from "./theme-placement";
import { refreshThemeBuyBoxHidden, setThemeBuyBoxHidden } from "./theme-buybox";

const DEFAULT_TRIGGER = "Strung";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function getStringingTriggerValue(wrapper?: HTMLElement | null): string {
  return wrapper?.dataset.triggerValue?.trim() || DEFAULT_TRIGGER;
}

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

export function isStrungSelection(
  value: string,
  trigger = DEFAULT_TRIGGER,
): boolean {
  return normalize(value) === normalize(trigger);
}

export function hasStringingGate(): boolean {
  return (
    document.querySelector("[data-proto-stringing-gate]") !== null ||
    findThemeStringingBlock() !== null
  );
}

function shouldHideThemeBuyBox(wrapper: HTMLElement): boolean {
  return wrapper.dataset.hideThemeBuybox !== "false";
}

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

let gateListenersBound = false;

function bindStringingSelect(select: HTMLSelectElement) {
  if (select.dataset.protoStringingGateBound) return;
  select.dataset.protoStringingGateBound = "true";
  select.addEventListener("change", () => applyStringingPageGate());
}

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

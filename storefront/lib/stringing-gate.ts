/**
 * stringing-gate.ts
 *
 * Builds the "stringing gate" UI in plain DOM (no React) for the FALLBACK case:
 * when the merchant enabled the app embed but did NOT add the theme "Configurator
 * Button" block to the product page. `entry.tsx#injectProductPageButton` calls
 * `createStringingGateWrapper` to inject an equivalent of the Liquid block at runtime.
 *
 * The markup it produces mirrors `extensions/proto-configurator/blocks/configurator-button.liquid`
 * exactly — same class names, same `data-*` hooks — so the gate logic in
 * `stringing-page-gate.ts` treats an injected wrapper and a Liquid-rendered wrapper
 * identically.
 */

/** Visible label above the Strung/Unstrung dropdown. */
export const STRINGING_DROPDOWN_LABEL = "Choose Your Stringing";
/** Dropdown value that reveals the Configure button (the "show configurator" trigger). */
export const STRINGING_TRIGGER_OPTION = "Strung";
/** The two dropdown choices, in order. */
export const STRINGING_OPTIONS = ["Strung", "Unstrung"] as const;

/**
 * Build a complete stringing-gate wrapper element (dropdown + hidden Configure button).
 *
 * The returned wrapper carries every attribute the gate/placement system relies on:
 * - `.proto-configurator-button-wrapper` + `data-proto-stringing-gate` mark it as a gate.
 * - A random `data-proto-stringing-gate-id` links the wrapper to its actions element
 *   (so `configure-placement.ts#getConfiguratorActions` can find them even after the
 *   actions node is relocated elsewhere in the DOM).
 * - `data-trigger-value="Strung"` and `data-hide-theme-buybox="true"` configure gate behaviour.
 *
 * The Configure button starts `hidden` — `applyStringingPageGate` reveals it once the
 * dropdown is on the trigger value. The caller is responsible for inserting the wrapper
 * into the page and binding listeners (via `initStringingPageGate`).
 *
 * @param productId Shopify product id, written to the button's `data-product-id` so the
 *   click handler knows which product to open the configurator for.
 * @returns A detached wrapper element ready to be inserted into the DOM.
 */
export function createStringingGateWrapper(productId: string): HTMLElement {
  const gateId = `gate-${Math.random().toString(36).slice(2, 9)}`;
  const wrapper = document.createElement("div");
  wrapper.className = "proto-configurator-button-wrapper";
  wrapper.dataset.protoStringingGate = "";
  wrapper.dataset.protoStringingGateId = gateId;
  wrapper.dataset.triggerValue = STRINGING_TRIGGER_OPTION;
  wrapper.dataset.hideThemeBuybox = "true";

  const field = document.createElement("div");
  field.className = "proto-configurator-field";

  const label = document.createElement("label");
  label.className = "proto-configurator-label";
  label.textContent = STRINGING_DROPDOWN_LABEL;

  const selectWrap = document.createElement("div");
  selectWrap.className = "proto-configurator-select-wrap";

  const select = document.createElement("select");
  select.className = "proto-configurator-select";
  select.dataset.protoStringingSelect = "";
  select.setAttribute("aria-label", STRINGING_DROPDOWN_LABEL);

  for (const option of STRINGING_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === STRINGING_TRIGGER_OPTION) opt.selected = true;
    select.appendChild(opt);
  }

  selectWrap.appendChild(select);
  field.appendChild(label);
  field.appendChild(selectWrap);

  const actions = document.createElement("div");
  actions.className = "proto-configurator-actions";
  actions.dataset.protoConfiguratorActions = "";
  actions.dataset.protoStringingGateId = gateId;
  actions.hidden = true;
  actions.setAttribute("aria-hidden", "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "proto-configurator-trigger";
  button.dataset.protoConfiguratorTrigger = "";
  button.dataset.productId = productId;
  button.textContent = "Configure";
  button.style.cssText =
    "width:100%;display:inline-flex;align-items:center;justify-content:center;border:none;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;min-height:48px;background-color:#c8102e;color:#fff;border-radius:6px;";

  actions.appendChild(button);
  wrapper.appendChild(field);
  wrapper.appendChild(actions);

  return wrapper;
}

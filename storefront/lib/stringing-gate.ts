export const STRINGING_DROPDOWN_LABEL = "Choose Your Stringing";
export const STRINGING_TRIGGER_OPTION = "Strung";
export const STRINGING_OPTIONS = ["Strung", "Unstrung"] as const;

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

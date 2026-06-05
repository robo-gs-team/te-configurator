export function showConfigureError(
  trigger: HTMLElement,
  message: string,
) {
  const wrapper =
    trigger.closest(".proto-configurator-button-wrapper") ?? trigger.parentElement;
  if (!wrapper) return;

  let el = wrapper.querySelector<HTMLElement>("[data-proto-configure-error]");
  if (!el) {
    el = document.createElement("p");
    el.dataset.protoConfigureError = "true";
    el.setAttribute("role", "alert");
    el.style.cssText =
      "margin:8px 0 0;font-size:13px;color:#b91c1c;line-height:1.4;";
    wrapper.appendChild(el);
  }
  el.textContent = message;
}

export function clearConfigureError(trigger: HTMLElement) {
  const wrapper = trigger.closest(".proto-configurator-button-wrapper");
  wrapper?.querySelector("[data-proto-configure-error]")?.remove();
}

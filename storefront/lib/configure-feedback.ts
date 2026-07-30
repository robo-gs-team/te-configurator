/**
 * configure-feedback.ts
 *
 * Inline, shopper-facing status under the Configure button: transient "still working" notes and
 * error messages. Both render as a small <p> inside the button's own wrapper, so they inherit the
 * theme's typography and can never disturb the rest of the buy box.
 */

/**
 * How long a load may run before we say anything.
 *
 * Deliberately not zero. In the common case the catalog is already warmed and the modal opens in
 * ~250-350ms, so a note shown immediately would flash in and straight back out — worse than
 * silence. This delay is slightly longer than that warmed path, so the note only ever appears when
 * the wait is long enough for a shopper to wonder whether their tap registered (a cold backend, a
 * slow connection). Kept short (~300ms) so cold mobile taps get visible feedback quickly.
 */
const LOADING_NOTE_DELAY_MS = 300;

/** Pending "show the note" timers, keyed by trigger so multiple buttons stay independent. */
const loadingTimers = new WeakMap<HTMLElement, number>();

/** The wrapper that hosts a trigger's inline messages. */
function feedbackHost(trigger: HTMLElement): HTMLElement | null {
  return (
    trigger.closest<HTMLElement>(".proto-v2-standalone-wrapper") ??
    trigger.closest<HTMLElement>(".proto-configurator-button-wrapper") ??
    trigger.parentElement ??
    document.querySelector<HTMLElement>(".proto-v2-standalone-wrapper")
  );
}

/**
 * Arm a delayed "still loading" note under the button.
 *
 * WHY THIS EXISTS: the loading state was previously opacity + `cursor: wait` only — and a wait
 * CURSOR does not exist on touch devices. A phone shopper on a cold start got nothing but a
 * slightly faded button for up to a few seconds, which reads as "my tap did nothing" and invites a
 * second tap. This note is the mobile-visible half of that feedback.
 */
export function startConfigureLoadingNote(
  trigger: HTMLElement,
  message = "Loading your options…",
) {
  clearConfigureLoadingNote(trigger);
  const timer = window.setTimeout(() => {
    loadingTimers.delete(trigger);
    const wrapper = feedbackHost(trigger);
    if (!wrapper) return;
    let el = wrapper.querySelector<HTMLElement>("[data-proto-configure-loading]");
    if (!el) {
      el = document.createElement("p");
      el.dataset.protoConfigureLoading = "true";
      // `status` + polite: announced by screen readers without interrupting, matching the
      // non-urgent nature of a progress note (errors use role=alert instead).
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.cssText = "margin:8px 0 0;font-size:13px;line-height:1.4;opacity:0.7;";
      wrapper.appendChild(el);
    }
    el.textContent = message;
  }, LOADING_NOTE_DELAY_MS);
  loadingTimers.set(trigger, timer);
}

/** Cancel a pending note and remove any note already shown. Safe to call unconditionally. */
export function clearConfigureLoadingNote(trigger: HTMLElement) {
  const pending = loadingTimers.get(trigger);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    loadingTimers.delete(trigger);
  }
  feedbackHost(trigger)?.querySelector("[data-proto-configure-loading]")?.remove();
}

export function showConfigureError(trigger: HTMLElement, message: string) {
  // An error supersedes any in-flight progress note — never show both at once.
  clearConfigureLoadingNote(trigger);

  const wrapper = feedbackHost(trigger);
  if (!wrapper) return;

  let el = wrapper.querySelector<HTMLElement>("[data-proto-configure-error]");
  if (!el) {
    el = document.createElement("p");
    el.dataset.protoConfigureError = "true";
    el.setAttribute("role", "alert");
    el.style.cssText = "margin:8px 0 0;font-size:13px;color:#b91c1c;line-height:1.4;";
    wrapper.appendChild(el);
  }
  el.textContent = message;
}

export function clearConfigureError(trigger: HTMLElement) {
  feedbackHost(trigger)?.querySelector("[data-proto-configure-error]")?.remove();
}

/**
 * legacy-button.ts
 *
 * Optional, opt-in replacement of a merchant's PRE-EXISTING ("legacy") configurator button with
 * ours — so a product page shows ONE configure button instead of two side by side.
 *
 * Scope is deliberately narrow and merchant-controlled:
 *   - It does nothing at all unless the merchant fills in a CSS selector on the Configurator
 *     Button block (blank = off, the default). No selector, no DOM surgery — ever.
 *   - Because the setting lives on the BLOCK, it is already template-scoped: the block only exists
 *     on the product templates the merchant added it to, so nothing here can affect any other
 *     template, product, or page.
 *   - It is strictly tied to OUR button's visibility (see applyLegacyButtonState): the legacy
 *     button is hidden only while our button is actually shown, and is restored the moment ours
 *     isn't (unlinked product, "Unstrung" selected, linkage failure). A shopper is therefore never
 *     left with NO configure button — the worst case is the original, pre-app behaviour.
 *
 * Every mutation is recorded and exactly reversible (original inline `display`, original DOM
 * position via a placeholder comment node), because the theme can re-render the buy box at any
 * time and we must never strand the merchant's own UI in a hidden state.
 */

/** How to treat the merchant's existing configurator button. */
export type LegacyMode = "hide" | "replace";

export type LegacyConfig = {
  /** CSS selector for the legacy button (or its wrapper). */
  selector: string;
  /**
   * "hide"    — hide the legacy button, leave ours wherever the merchant placed the block.
   * "replace" — additionally MOVE our button into the legacy button's exact position, so ours
   *             inherits the spot (and surrounding layout) the merchant's theme already had.
   */
  mode: LegacyMode;
};

type HiddenRecord = { el: HTMLElement; display: string };

/** Legacy elements currently hidden by us, with their prior inline display values. */
let hiddenRecords: HiddenRecord[] = [];
/** Set while our wrapper has been moved, so the move can be undone exactly. */
let moveRecord: { wrapper: HTMLElement; placeholder: Comment } | null = null;

/** True if this element is (or contains) our own UI — never hide or clobber ourselves. */
function isOurElement(el: Element): boolean {
  return Boolean(
    el.closest(".proto-configurator-button-wrapper") ||
      el.closest("[data-proto-v2-standalone]") ||
      el.querySelector?.(".proto-configurator-button-wrapper") ||
      el.querySelector?.("[data-proto-v2-standalone]"),
  );
}

/**
 * Read the merchant's legacy-button settings off our own wrapper, where the Liquid block renders
 * them as data attributes. @returns null when unset/blank (the default) — meaning "do nothing".
 */
export function readLegacyConfig(): LegacyConfig | null {
  const wrapper = document.querySelector<HTMLElement>("[data-proto-legacy-selector]");
  const selector = wrapper?.dataset.protoLegacySelector?.trim();
  if (!selector) return null;
  const mode: LegacyMode =
    wrapper?.dataset.protoLegacyMode === "replace" ? "replace" : "hide";
  return { selector, mode };
}

/**
 * Resolve the legacy elements to hide. Invalid selectors (a merchant typo) must not throw and
 * take down the whole bundle — querySelectorAll raises SyntaxError on malformed input, so it's
 * guarded. Our own elements are always excluded.
 */
function findLegacyElements(selector: string): HTMLElement[] {
  let nodes: NodeListOf<Element>;
  try {
    nodes = document.querySelectorAll(selector);
  } catch {
    // Malformed selector from the theme editor — treat as "no match" rather than breaking.
    return [];
  }
  const found: HTMLElement[] = [];
  nodes.forEach((node) => {
    if (node instanceof HTMLElement && !isOurElement(node)) found.push(node);
  });
  return found;
}

/** Hide the legacy elements (recording prior state), and optionally move our button into place. */
function engage(config: LegacyConfig): void {
  const targets = findLegacyElements(config.selector);
  if (targets.length === 0) return; // nothing matched (yet) — a later re-run may find it

  // Re-record from scratch each time: the theme may have re-rendered the buy box since we last
  // hid it, which would make previously-recorded nodes stale and leave the new ones visible.
  restoreHidden();

  hiddenRecords = targets.map((el) => {
    const display = el.style.display;
    el.style.setProperty("display", "none", "important");
    el.setAttribute("aria-hidden", "true");
    el.dataset.protoLegacyHidden = "true";
    return { el, display };
  });

  if (config.mode !== "replace" || moveRecord) return;

  // Move our wrapper into the first legacy element's slot, leaving a comment node behind so the
  // original position can be restored exactly.
  const wrapper = document.querySelector<HTMLElement>(
    ".proto-v2-standalone-wrapper, .proto-configurator-button-wrapper",
  );
  const anchor = targets[0];
  if (!wrapper || !anchor.parentNode || wrapper.contains(anchor)) return;

  const placeholder = document.createComment("proto-configurator-original-position");
  wrapper.parentNode?.insertBefore(placeholder, wrapper);
  anchor.parentNode.insertBefore(wrapper, anchor);
  moveRecord = { wrapper, placeholder };
}

/** Put every hidden legacy element back exactly as it was. */
function restoreHidden(): void {
  hiddenRecords.forEach(({ el, display }) => {
    if (display) el.style.display = display;
    else el.style.removeProperty("display");
    el.removeAttribute("aria-hidden");
    delete el.dataset.protoLegacyHidden;
  });
  hiddenRecords = [];
}

/** Undo the "replace" move, returning our wrapper to where the merchant's block put it. */
function restoreMove(): void {
  if (!moveRecord) return;
  const { wrapper, placeholder } = moveRecord;
  placeholder.parentNode?.insertBefore(wrapper, placeholder);
  placeholder.remove();
  moveRecord = null;
}

/**
 * The single entry point, driven by whether OUR button is currently shown.
 *
 * @param ourButtonVisible true when our Configure button is visible to the shopper. Hiding the
 *   merchant's button is allowed ONLY in that case; anything else (product not linked, "Unstrung"
 *   selected, a failed linkage check) restores their button immediately, so the page always has a
 *   working configure path.
 */
export function applyLegacyButtonState(ourButtonVisible: boolean): void {
  const config = readLegacyConfig();
  if (!config) return; // feature off — never touch the page

  if (ourButtonVisible) {
    engage(config);
  } else {
    restoreMove();
    restoreHidden();
  }
}

/** Unconditionally restore the merchant's button — used when the app bails out entirely. */
export function restoreLegacyButton(): void {
  restoreMove();
  restoreHidden();
}

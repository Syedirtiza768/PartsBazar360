"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "summary",
  "[contenteditable='true']",
].join(",");

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

/**
 * Keeps keyboard focus inside an open overlay and restores it to the trigger
 * on close, so a drawer can never strand a keyboard or screen-reader user
 * behind the scrim ("navigation overlays must not trap users").
 *
 * Tab cycles within the overlay; Escape is handled by the caller so it can
 * distinguish nested overlays.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocus }: { initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const moveFocus = () => {
      const target = initialFocus?.current ?? focusable(root)[0] ?? root;
      // Don't yank focus back if the user has already tabbed somewhere inside.
      if (!root.contains(document.activeElement)) target.focus({ preventScroll: true });
    };

    /*
     * Focus lands immediately, then again on the next frame once the entrance
     * animation has laid the content out (the first focusable child may not be
     * measurable yet on the initial pass).
     *
     * The synchronous call is not redundant: requestAnimationFrame does not
     * fire while the document is hidden, so a drawer opened in a backgrounded
     * tab would otherwise leave focus stranded on the page behind the scrim —
     * exactly the trap this hook exists to prevent.
     */
    moveFocus();
    const raf = requestAnimationFrame(moveFocus);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const items = focusable(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
    // `initialFocus` is a ref object — stable across renders by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}

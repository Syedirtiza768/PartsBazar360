"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { XIcon } from "./icons";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import { useFocusTrap } from "./use-focus-trap";

/**
 * The single overlay primitive for the platform. Every drawer, filter panel,
 * dialog and confirmation sheet is built from it, so they all inherit the same
 * behaviour instead of each re-implementing (and each getting wrong) scroll
 * locking, focus management, safe areas, and viewport fitting.
 *
 * Layout contract, on every side and size:
 *  · the panel never exceeds the *dynamic* viewport, so mobile browser chrome
 *    can never clip the footer actions;
 *  · header and footer stay pinned while only the body scrolls;
 *  · the body's scroll does not chain to the page behind it;
 *  · bottom padding clears the home indicator.
 */

export type SheetSide = "bottom" | "right" | "left" | "center";

export type SheetSize = "sm" | "md" | "lg" | "full";

const CENTER_SIZE: Record<SheetSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  full: "sm:max-w-5xl",
};

const SIDE_SIZE: Record<SheetSize, string> = {
  sm: "w-[min(20rem,88vw)]",
  md: "w-[min(24rem,90vw)]",
  lg: "w-[min(32rem,94vw)]",
  full: "w-screen",
};

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered as the visible heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  /**
   * "center" is a bottom sheet on phones and a centred dialog from `sm` up —
   * the right default for confirmations and forms. "left"/"right" are side
   * drawers (navigation, filters). "bottom" is always a bottom sheet.
   */
  side?: SheetSide;
  size?: SheetSize;
  /** Pinned action area. Gets safe-area padding automatically. */
  footer?: ReactNode;
  /** Element to focus on open; defaults to the first focusable node. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  side = "center",
  size = "md",
  footer,
  initialFocus,
  bodyClassName,
  className,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `sheet-title-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const descId = description ? `${titleId}-desc` : undefined;

  useBodyScrollLock(open);
  useFocusTrap(panelRef, open, { initialFocus });

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const isCenter = side === "center";
  const isBottom = side === "bottom";
  const isSide = side === "left" || side === "right";

  return createPortal(
    <div className="fixed inset-0 z-modal" role="presentation">
      {/*
        A plain <div> rather than a <button>: the scrim must not appear in the
        tab order (it would be the first stop inside the trap) and its action is
        already available from the labelled close button and the Escape key.
      */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-graphite-950/55 backdrop-blur-[2px] animate-fade-in"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={cn(
          "absolute flex flex-col overflow-hidden bg-white shadow-overlay outline-none",
          // Bottom sheet — phones, and the small end of "center".
          (isBottom || isCenter) &&
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl animate-slide-in-up",
          // Centred dialog from sm up.
          isCenter &&
            cn(
              "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(42rem,88dvh)] sm:w-[calc(100vw-3rem)]",
              "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:animate-scale-in",
              CENTER_SIZE[size],
            ),
          // Side drawer — full height, edge-anchored.
          isSide &&
            cn(
              "inset-y-0 h-dvh max-w-full",
              SIDE_SIZE[size],
              side === "right" ? "right-0 animate-slide-in-right" : "left-0 animate-slide-in-left",
            ),
          className,
        )}
      >
        {/* Grab affordance — signals "swipe/tap to dismiss" without being the
            only way to dismiss (the close button always exists). */}
        {(isBottom || isCenter) && (
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
        )}

        <div
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 px-5 py-4",
            "border-b border-slate-200",
            hideTitle && "sr-only",
          )}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-graphite-600">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="-mr-2 -mt-1.5 flex touch-target shrink-0 items-center justify-center rounded-lg text-graphite-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* When the title is visually hidden the close control still has to be
            reachable, so render a floating one. */}
        {hideTitle && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="absolute right-3 top-3 z-10 flex touch-target items-center justify-center rounded-lg bg-white/90 text-graphite-600 shadow-card transition-colors hover:text-slate-900"
          >
            <XIcon className="h-5 w-5" />
          </button>
        )}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-none-y px-5 py-4",
            // Without a footer the body itself must clear the home indicator.
            !footer && "pb-safe-b-4",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-slate-200 bg-white px-5 pb-safe-b-4 pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Centred dialog — a `Sheet` with the confirmation/form defaults. */
export function Modal(props: Omit<SheetProps, "side">) {
  return <Sheet {...props} side="center" />;
}

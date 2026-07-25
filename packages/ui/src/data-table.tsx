"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./cn";

/**
 * Responsive data display.
 *
 * A wide desktop table squeezed into 320px is unreadable, and hiding columns
 * loses data. `DataTable` therefore renders two presentations of the *same*
 * column definitions: a real <table> from `md` up, and a stacked card list
 * below it, where each column becomes a labelled field. Nothing is dropped —
 * priority only decides where a value lands in the card.
 *
 * For genuinely numeric, comparison-oriented grids where the table shape is the
 * point, use `TableScroller` instead: it keeps the table and adds a keyboard-
 * reachable horizontal scroll region with a sticky identifier column.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /**
   * Card placement:
   *  · "primary"   — the card's heading (use for the row identifier)
   *  · "secondary" — the meta line directly under the heading
   *  · "detail"    — a labelled row in the card body (default)
   */
  priority?: "primary" | "secondary" | "detail";
  align?: "left" | "right" | "center";
  /** Applied to <td>. */
  className?: string;
  /** Applied to <th>. */
  headerClassName?: string;
  /** Omit from the card only — for values already shown by another column. */
  hideOnCard?: boolean;
  /** Omit from the table only. */
  hideOnTable?: boolean;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  getRowKey: (row: T, index: number) => string;
  /** Required: names the table for screen readers and the scroll region. */
  caption: string;
  /** Visually show the caption above the table. */
  showCaption?: boolean;
  /** Row-level actions. Rendered in a trailing table column and in each card. */
  actions?: (row: T) => ReactNode;
  actionsLabel?: string;
  /** Shown in place of everything when `rows` is empty. */
  empty?: ReactNode;
  /** Breakpoint at which the real table takes over. */
  tableFrom?: "md" | "lg" | "xl";
  className?: string;
}

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const TABLE_FROM: Record<NonNullable<DataTableProps<unknown>["tableFrom"]>, [string, string]> = {
  md: ["hidden md:block", "md:hidden"],
  lg: ["hidden lg:block", "lg:hidden"],
  xl: ["hidden xl:block", "xl:hidden"],
};

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  caption,
  showCaption = false,
  actions,
  actionsLabel = "Actions",
  empty,
  tableFrom = "md",
  className,
}: DataTableProps<T>) {
  const [tableClass, cardClass] = TABLE_FROM[tableFrom];

  if (rows.length === 0 && empty) return <>{empty}</>;

  const tableColumns = columns.filter((c) => !c.hideOnTable);
  const cardColumns = columns.filter((c) => !c.hideOnCard);
  const primary = cardColumns.find((c) => c.priority === "primary");
  const secondary = cardColumns.filter((c) => c.priority === "secondary");
  const details = cardColumns.filter((c) => !c.priority || c.priority === "detail");

  return (
    <div className={className}>
      {showCaption && (
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{caption}</h2>
      )}

      {/* ── Table presentation ─────────────────────────────────────────── */}
      <div className={tableClass}>
        <TableScroller label={caption}>
          <table className="w-full min-w-full border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {tableColumns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-graphite-600",
                      ALIGN[column.align ?? "left"],
                      column.headerClassName,
                    )}
                  >
                    {column.header}
                  </th>
                ))}
                {actions && (
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-graphite-600">
                    {actionsLabel}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => (
                <tr key={getRowKey(row, index)} className="transition-colors hover:bg-slate-50/70">
                  {tableColumns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-3 align-middle text-slate-700",
                        ALIGN[column.align ?? "left"],
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </div>

      {/* ── Card presentation ──────────────────────────────────────────── */}
      <ul className={cn("space-y-3", cardClass)} aria-label={caption}>
        {rows.map((row, index) => (
          <li
            key={getRowKey(row, index)}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"
          >
            {primary && (
              <div className="text-sm font-semibold text-slate-900">{primary.cell(row)}</div>
            )}
            {secondary.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-graphite-600">
                {secondary.map((column) => (
                  <span key={column.key} className="min-w-0">
                    {column.cell(row)}
                  </span>
                ))}
              </div>
            )}

            {details.length > 0 && (
              <dl
                className={cn(
                  "grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-2 text-sm",
                  (primary || secondary.length > 0) && "mt-3 border-t border-slate-100 pt-3",
                )}
              >
                {details.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-xs font-medium uppercase tracking-wide text-graphite-600">
                      {column.header}
                    </dt>
                    <dd className="min-w-0 break-anywhere text-slate-800">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {actions && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {actions(row)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Keyboard- and screen-reader-accessible horizontal scroll container.
 *
 * A scrollable region that can only be reached with a mouse wheel or a swipe is
 * a WCAG failure, so this is a labelled `region` with `tabindex=0`: keyboard
 * users can focus it and arrow through. The edge shadows are the visible
 * affordance that there is more content sideways — without them a clipped
 * table just looks like a table with missing columns.
 */
export function TableScroller({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 1,
      // 1px tolerance: fractional layout widths otherwise leave the shadow on.
      right: el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Column widths change as content loads, not just as the box resizes.
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={`${label} (scrollable)`}
      tabIndex={0}
      onScroll={measure}
      className={cn(
        "scrollbar-thin overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200 bg-white",
        edges.left && edges.right
          ? "shadow-[inset_12px_0_12px_-12px_rgb(13_21_25/0.16),inset_-12px_0_12px_-12px_rgb(13_21_25/0.16)]"
          : edges.left
            ? "shadow-scroll-l"
            : edges.right
              ? "shadow-scroll-r"
              : undefined,
        className,
      )}
    >
      {children}
    </div>
  );
}

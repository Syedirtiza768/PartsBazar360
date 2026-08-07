"use client";

import { useState } from "react";
import { Modal } from "@repo/ui/sheet";
import { RefreshIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";

/**
 * Compact returns disclosure with a "See details" modal. Shared by cart and
 * checkout so the policy text lives in one place.
 */
export function ReturnsPolicyNote({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-graphite-600", className)}>
        <RefreshIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          *30 Days Returns Accepted.{" "}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            See details.
          </button>
        </span>
      </p>

      <Modal open={open} onClose={() => setOpen(false)} title="Returns policy">
        <div className="space-y-4 text-sm leading-relaxed text-slate-700">
          <div>
            <p className="font-semibold text-slate-900">New parts</p>
            <p className="mt-1 text-graphite-600">
              New parts are not eligible for return. Please confirm fitment and specifications
              before placing your order — each cart line shows its compatibility status to help
              with this.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Used parts</p>
            <p className="mt-1 text-graphite-600">
              Used parts can be returned within 30 days of delivery, but only if the part
              arrives damaged or has a fault. The buyer is responsible for the return shipping
              cost.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-graphite-600">
            To start a return, contact support with your order number and photos of the issue
            within 30 days of delivery.
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import { ImageGallery } from "./ImageGallery";
import { BuyBox, StickyMobileBar } from "./BuyBox";
import { useEnrichmentReconcile } from "@/lib/use-enrichment-reconcile";
import type { Part } from "@/lib/types";

/**
 * Client shell around the gallery and buy box so a background enrichment job
 * can upgrade shipping weight and inject the infographic without a full reload.
 *
 * The RSC still owns first paint data; this only reconciles afterwards. Details
 * below the gallery (fitment, specs) are passed as children so they stay in the
 * same grid without becoming client components themselves.
 */
export function PartDetailLive({
  part,
  children,
}: {
  part: Part;
  children?: ReactNode;
}) {
  const { shipping, images, refining } = useEnrichmentReconcile(part);
  const livePart: Part = { ...part, shipping, imageUrls: images };

  return (
    <>
      {/*
        Grid placement keeps a sensible mobile order (gallery → buy box →
        details) while the buy box occupies a sticky right rail on desktop.
      */}
      <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <ImageGallery images={images} title={part.title} />
          {refining ? (
            <p className="mt-2 text-xs text-graphite-600" aria-live="polite">
              Refining shipping weight…
            </p>
          ) : null}
        </div>

        <aside
          className="min-w-0 self-start lg:sticky lg:top-28 lg:row-span-2"
          aria-label="Purchase options"
        >
          <BuyBox part={livePart} />
        </aside>

        {children}
      </div>
      <StickyMobileBar part={livePart} />
    </>
  );
}

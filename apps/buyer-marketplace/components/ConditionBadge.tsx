import { Badge, type BadgeTone } from "@repo/ui/badge";
import { humanize } from "@/lib/format";

/**
 * Communicates what a buyer is physically getting: quality tier
 * (new / used / refurbished / remanufactured / for parts) and source
 * (genuine OEM vs aftermarket). Text + tone, never color alone.
 */

const TIER_TONES: Record<string, BadgeTone> = {
  NEW: "success",
  USED: "neutral",
  REFURBISHED: "info",
  REMANUFACTURED: "info",
  FOR_PARTS: "warning",
};

export function ConditionBadge({
  qualityTier,
  size = "md",
  className,
}: {
  qualityTier?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!qualityTier) return null;
  const key = qualityTier.toUpperCase();
  return (
    <Badge tone={TIER_TONES[key] ?? "neutral"} size={size} className={className}>
      {humanize(qualityTier)}
    </Badge>
  );
}

export function SourceBadge({
  partSource,
  size = "md",
  className,
}: {
  partSource?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!partSource) return null;
  const key = partSource.toUpperCase();
  const label = key === "OEM" ? "Genuine OEM" : humanize(partSource);
  return (
    <Badge tone={key === "OEM" ? "brand" : "outline"} size={size} className={className}>
      {label}
    </Badge>
  );
}

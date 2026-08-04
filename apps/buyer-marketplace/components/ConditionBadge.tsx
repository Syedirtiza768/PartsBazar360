import { Badge, type BadgeTone } from "@repo/ui/badge";
import { humanize } from "@/lib/format";
import { partTypeLabel, partTypeFromLegacy } from "@repo/catalog-contracts";

/**
 * Communicates what a buyer is physically getting: quality tier
 * (new / used / refurbished / remanufactured / for parts) and controlled
 * part type (genuine OEM / aftermarket / used original). Text + tone, never color alone.
 */

const TIER_TONES: Record<string, BadgeTone> = {
  NEW: "success",
  USED: "neutral",
  REFURBISHED: "info",
  REMANUFACTURED: "info",
  FOR_PARTS: "warning",
};

const PART_TYPE_TONES: Record<string, BadgeTone> = {
  GENUINE_OEM: "brand",
  AFTERMARKET: "outline",
  SALVAGE_OEM: "warning",
  REMANUFACTURED: "info",
  REFURBISHED: "info",
  UNCLASSIFIED: "neutral",
};

// Genuine OEM needs no condition qualifier — the type badge ("Genuine OEM")
// is the only badge. Condition badges are suppressed for this type.
function isPartTypeGenuine(partSource?: string | null, partType?: string | null): boolean {
  const resolved = partTypeFromLegacy(partSource, partType);
  return resolved === 'GENUINE_OEM';
}

/** Returns true when condition should be hidden (GENUINE_OEM or equivalent). */
export function shouldSuppressCondition(
  partSource?: string | null,
  partType?: string | null,
): boolean {
  if (!partSource && !partType) return false;
  return isPartTypeGenuine(partSource, partType);
}

export function ConditionBadge({
  qualityTier,
  partSource,
  partType: _partType,
  size = "md",
  className,
}: {
  qualityTier?: string | null;
  partSource?: string | null;
  partType?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!qualityTier) return null;
  if (shouldSuppressCondition(partSource, _partType)) return null;
  const key = qualityTier.toUpperCase();
  return (
    <Badge tone={TIER_TONES[key] ?? "neutral"} size={size} className={className}>
      {humanize(qualityTier)}
    </Badge>
  );
}

export function SourceBadge({
  partSource,
  partType,
  size = "md",
  className,
}: {
  partSource?: string | null;
  partType?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const resolved = partTypeFromLegacy(partSource, partType);
  if (!partSource && !partType) return null;
  return (
    <Badge tone={PART_TYPE_TONES[resolved] ?? "outline"} size={size} className={className}>
      {partTypeLabel(resolved)}
    </Badge>
  );
}

export function PartTypeBadge({
  partType,
  partSource,
  size = "md",
  className,
}: {
  partType?: string | null;
  partSource?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  return <SourceBadge partType={partType} partSource={partSource} size={size} className={className} />;
}

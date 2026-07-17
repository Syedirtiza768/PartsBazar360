import { Badge, type BadgeTone } from "@repo/ui/badge";

/** Maps backend status strings to the shared badge language. */

const STATUS_TONES: Record<string, BadgeTone> = {
  // offers / listings
  ACTIVE: "success",
  INACTIVE: "neutral",
  PAUSED: "warning",
  // orders
  AWAITING_PAYMENT: "warning",
  PROCESSING: "warning",
  SHIPPED: "success",
  DELIVERED: "success",
  CANCELLED: "danger",
  // uploads
  COMPLETED: "success",
  NEEDS_REVIEW: "warning",
  FAILED: "danger",
  IMPORTED: "success",
  INVALID: "danger",
  APPROVED: "success",
  REJECTED: "danger",
  // onboarding
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  NEEDS_INFORMATION: "warning",
  APPROVED_SELLER: "success",
  VERIFIED: "success",
};

export function StatusBadge({ status, size = "md" }: { status?: string | null; size?: "sm" | "md" }) {
  if (!status) return null;
  const key = status.toUpperCase();
  const label = key.replace(/_/g, " ").toLowerCase();
  return (
    <Badge tone={STATUS_TONES[key] ?? "neutral"} size={size} className="capitalize">
      {label}
    </Badge>
  );
}

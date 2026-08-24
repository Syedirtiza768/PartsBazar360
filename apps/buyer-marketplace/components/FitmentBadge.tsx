import { Badge, type BadgeTone } from "@repo/ui/badge";
import {
  ShieldCheckIcon,
  CheckIcon,
  AlertTriangleIcon,
  XIcon,
  GlobeIcon,
  HelpIcon,
} from "@repo/ui/icons";
import { FITMENT_COPY, type FitmentState } from "@/lib/fitment";

const STATE_VISUALS: Record<FitmentState, { tone: BadgeTone; icon: React.ReactNode }> = {
  verified: { tone: "success", icon: <ShieldCheckIcon /> },
  likely: { tone: "info", icon: <CheckIcon /> },
  check: { tone: "warning", icon: <AlertTriangleIcon /> },
  incompatible: { tone: "danger", icon: <XIcon /> },
  universal: { tone: "neutral", icon: <GlobeIcon /> },
  unknown: { tone: "outline", icon: <HelpIcon /> },
};

export function FitmentBadge({
  state,
  vehicleName,
  size = "md",
  className,
}: {
  state: FitmentState;
  /** Short vehicle name for personalized copy ("Fits your BMW 7 Series"). */
  vehicleName?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  // Compatibility rows are already shown in the listing/PDP table. Do not
  // add a warning-style badge for a vehicle mismatch when evidence exists.
  if (state === "check" || state === "unknown") return null;

  const visuals = STATE_VISUALS[state];
  const copy = FITMENT_COPY[state];
  const label =
    vehicleName && copy.withVehicle ? copy.withVehicle(vehicleName) : copy.label;

  return (
    <Badge tone={visuals.tone} size={size} icon={visuals.icon} className={className}>
      {label}
    </Badge>
  );
}

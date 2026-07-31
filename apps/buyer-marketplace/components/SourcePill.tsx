import { Badge, type BadgeTone } from "@repo/ui/badge";

const SOURCE_TAG_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  FEB: { label: "FEBEST", tone: "success" },
  DYN: { label: "Dynatrade", tone: "info" },
  TRU: { label: "Trade Union", tone: "warning" },
  DXB: { label: "DXB", tone: "brand" },
  SPC: { label: "Sparco", tone: "info" },
  SPD: { label: "Sparco DS", tone: "neutral" },
  SAL: { label: "Salvage", tone: "danger" },
  BLK: { label: "Blackline", tone: "dark" },
  GEN: { label: "General", tone: "outline" },
};

export function SourcePill({
  tag,
  size = "sm",
  className,
}: {
  tag?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!tag) return null;
  const config = SOURCE_TAG_CONFIG[tag] ?? { label: tag, tone: "outline" as BadgeTone };
  return (
    <Badge tone={config.tone} size={size} className={className}>
      {config.label}
    </Badge>
  );
}

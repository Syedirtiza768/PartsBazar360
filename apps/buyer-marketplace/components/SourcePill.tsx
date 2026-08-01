import { Badge, type BadgeTone } from "@repo/ui/badge";

export const SOURCE_TAG_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  BST: { label: "FEBEST", tone: "success" },
  AAP: { label: "DXB EXW", tone: "brand" },
  YNTD: { label: "Dynatrade", tone: "info" },
  PSRC: { label: "Sparco", tone: "info" },
  TNRU: { label: "Trade Union", tone: "warning" },
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

import {
  BoxIcon,
  CarIcon,
  EngineIcon,
  BatteryIcon,
  SeatIcon,
  BrakeDiscIcon,
  SuspensionIcon,
  WheelIcon,
  GearboxIcon,
  FanIcon,
  ExhaustIcon,
  type IconProps,
} from "@repo/ui/icons";

const CATEGORY_ICONS: Record<string, (props: IconProps) => React.ReactNode> = {
  general: BoxIcon,
  body: CarIcon,
  engine: EngineIcon,
  electrical: BatteryIcon,
  interior: SeatIcon,
  brakes: BrakeDiscIcon,
  suspension: SuspensionIcon,
  wheels: WheelIcon,
  transmission: GearboxIcon,
  cooling: FanIcon,
  exhaust: ExhaustIcon,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category.toLowerCase()] ?? BoxIcon;
  return <Icon className={className} />;
}

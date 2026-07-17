import type { SVGProps } from "react";

/**
 * Shared icon set — 24×24 viewBox, stroke-based (1.8), sized via className
 * (defaults to w-5 h-5). Decorative by default (aria-hidden); pass a `title`
 * for semantic usage.
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  title?: string;
}

function base(props: IconProps) {
  const { title, className, ...rest } = props;
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: className ?? "w-5 h-5",
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    ...rest,
  };
}

function make(name: string, path: React.ReactNode) {
  function Icon(props: IconProps) {
    const { title } = props;
    return (
      <svg {...base(props)}>
        {title ? <title>{title}</title> : null}
        {path}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const SearchIcon = make(
  "SearchIcon",
  <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />,
);

export const CartIcon = make(
  "CartIcon",
  <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />,
);

export const CarIcon = make(
  "CarIcon",
  <>
    <path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11" />
    <path d="M4 11h16a1 1 0 011 1v4a1 1 0 01-1 1h-1M4 11a1 1 0 00-1 1v4a1 1 0 001 1h1m0 0a2 2 0 104 0m-4 0h10m0 0a2 2 0 104 0" />
  </>,
);

export const GaugeIcon = make(
  "GaugeIcon",
  <>
    <path d="M12 15l3.5-3.5" />
    <path d="M20.3 18a9 9 0 10-16.6 0" />
  </>,
);

export const WrenchIcon = make(
  "WrenchIcon",
  <path d="M14.7 6.3a4.5 4.5 0 00-6 5.9L3 17.9V21h3.1l5.7-5.7a4.5 4.5 0 005.9-6L14.6 12l-2.6-2.6 2.7-3.1z" />,
);

export const CheckIcon = make("CheckIcon", <path d="M5 13l4 4L19 7" />);

export const CheckCircleIcon = make(
  "CheckCircleIcon",
  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
);

export const ShieldCheckIcon = make(
  "ShieldCheckIcon",
  <path d="M9 12l2 2 4-4m5.6-2.6c0 6.2-3.8 9.5-8.2 11.4a1.5 1.5 0 01-.9 0C7.2 16.9 3.4 13.6 3.4 7.4c0-.6.4-1.1.9-1.3C6 5.5 9 4.5 11.4 3.2a1.4 1.4 0 011.3 0C15 4.5 18 5.5 19.7 6.1c.5.2.9.7.9 1.3z" />,
);

export const AlertTriangleIcon = make(
  "AlertTriangleIcon",
  <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
);

export const AlertCircleIcon = make(
  "AlertCircleIcon",
  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
);

export const InfoIcon = make(
  "InfoIcon",
  <path d="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
);

export const HelpIcon = make(
  "HelpIcon",
  <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3m.1 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
);

export const XIcon = make("XIcon", <path d="M6 18L18 6M6 6l12 12" />);

export const XCircleIcon = make(
  "XCircleIcon",
  <path d="M15 9l-6 6m0-6l6 6m12-3a9 9 0 11-18 0 9 9 0 0118 0z" transform="translate(-6 0) scale(1)" />,
);

export const PlusIcon = make("PlusIcon", <path d="M12 5v14m-7-7h14" />);

export const MinusIcon = make("MinusIcon", <path d="M5 12h14" />);

export const TrashIcon = make(
  "TrashIcon",
  <path d="M19 7l-.9 12.1A2 2 0 0116.1 21H7.9a2 2 0 01-2-1.9L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />,
);

export const ChevronDownIcon = make("ChevronDownIcon", <path d="M6 9l6 6 6-6" />);
export const ChevronUpIcon = make("ChevronUpIcon", <path d="M18 15l-6-6-6 6" />);
export const ChevronLeftIcon = make("ChevronLeftIcon", <path d="M15 18l-6-6 6-6" />);
export const ChevronRightIcon = make("ChevronRightIcon", <path d="M9 6l6 6-6 6" />);

export const ArrowRightIcon = make("ArrowRightIcon", <path d="M4 12h16m0 0l-6-6m6 6l-6 6" />);
export const ArrowLeftIcon = make("ArrowLeftIcon", <path d="M20 12H4m0 0l6 6m-6-6l6-6" />);

export const TruckIcon = make(
  "TruckIcon",
  <>
    <path d="M1 8h12v8H1zM13 10h4l3 3v3h-7" />
    <path d="M5.5 19a2 2 0 100-4 2 2 0 000 4zm11 0a2 2 0 100-4 2 2 0 000 4z" />
  </>,
);

export const PackageIcon = make(
  "PackageIcon",
  <path d="M21 8l-9-5-9 5m18 0v8l-9 5m9-13l-9 5m0 8V13m0 8l-9-5V8m9 5L3 8" />,
);

export const BoxIcon = make(
  "BoxIcon",
  <path d="M4 7.5L12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9m0-9L4 7.5" />,
);

export const StoreIcon = make(
  "StoreIcon",
  <path d="M3 9l1.5-5h15L21 9M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M5 9v11h14V9m-9 11v-6h4v6" />,
);

export const UserIcon = make(
  "UserIcon",
  <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
);

export const StarIcon = make(
  "StarIcon",
  <path d="M11.5 3.6a.55.55 0 011 0l2.1 4.9 5.3.5c.5 0 .7.6.3.9l-4 3.5 1.2 5.2c.1.5-.4.8-.8.6L12 16.5l-4.6 2.7c-.4.2-.9-.1-.8-.6l1.2-5.2-4-3.5c-.4-.3-.2-.9.3-.9l5.3-.5 2.1-4.9z" />,
);

export const HeartIcon = make(
  "HeartIcon",
  <path d="M12 20.3l-7.1-7.1a4.6 4.6 0 116.5-6.5l.6.6.6-.6a4.6 4.6 0 116.5 6.5L12 20.3z" />,
);

export const FilterIcon = make(
  "FilterIcon",
  <path d="M4 5h16M7 12h10m-7 7h4" />,
);

export const SlidersIcon = make(
  "SlidersIcon",
  <path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h13m4 0h-1M13 4v4M7 10v4m10 2v4" />,
);

export const CopyIcon = make(
  "CopyIcon",
  <path d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M4 10a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" />,
);

export const ExternalLinkIcon = make(
  "ExternalLinkIcon",
  <path d="M13 5h6v6m0-6L10 14M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2" />,
);

export const MenuIcon = make("MenuIcon", <path d="M4 6h16M4 12h16M4 18h16" />);

export const GlobeIcon = make(
  "GlobeIcon",
  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-9c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9s1.4-6.6 3.9-9zM3 12h18" />,
);

export const TagIcon = make(
  "TagIcon",
  <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7A2 2 0 013 12.2V5a2 2 0 012-2h7.2a2 2 0 011.4.6l7 7a2 2 0 010 2.8zM7.5 7.5h.01" />,
);

export const ClipboardIcon = make(
  "ClipboardIcon",
  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
);

export const FileTextIcon = make(
  "FileTextIcon",
  <path d="M14 3v5h5M9 13h6m-6 4h6M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />,
);

export const UploadIcon = make(
  "UploadIcon",
  <path d="M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
);

export const RefreshIcon = make(
  "RefreshIcon",
  <path d="M20 12a8 8 0 10-2.3 5.6M20 12V7m0 5h-5" />,
);

export const ClockIcon = make(
  "ClockIcon",
  <path d="M12 7v5l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
);

export const MapPinIcon = make(
  "MapPinIcon",
  <path d="M12 21s-7-5.1-7-11a7 7 0 1114 0c0 5.9-7 11-7 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
);

export const MailIcon = make(
  "MailIcon",
  <path d="M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zm0 1l8 6 8-6" />,
);

export const MessageIcon = make(
  "MessageIcon",
  <path d="M21 12a8 8 0 01-8 8H4l2.3-2.9A8 8 0 1121 12z" />,
);

export const CreditCardIcon = make(
  "CreditCardIcon",
  <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 3h18M7 15h4" />,
);

export const ShieldIcon = make(
  "ShieldIcon",
  <path d="M20.6 6.1C18.9 5.5 15 4.5 12.7 3.2a1.4 1.4 0 00-1.3 0C9 4.5 6 5.5 4.3 6.1c-.5.2-.9.7-.9 1.3 0 6.2 3.8 9.5 8.2 11.4.3.1.6.1.9 0 4.4-1.9 8.2-5.2 8.2-11.4 0-.6-.4-1.1-.9-1.3z" />,
);

export const RotateCcwIcon = make(
  "RotateCcwIcon",
  <path d="M4 12a8 8 0 102.3-5.6M4 12V7m0 5h5" />,
);

export const HomeIcon = make(
  "HomeIcon",
  <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-9z" />,
);

export const GridIcon = make(
  "GridIcon",
  <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
);

export const EyeIcon = make(
  "EyeIcon",
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z" />,
);

export const CameraIcon = make(
  "CameraIcon",
  <path d="M4 8h2.6l1.5-2.3A1.5 1.5 0 019.4 5h5.2a1.5 1.5 0 011.3.7L17.4 8H20a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zm8 8.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />,
);

export const SettingsIcon = make(
  "SettingsIcon",
  <>
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </>,
);

export const DollarIcon = make(
  "DollarIcon",
  <path d="M12 2v20m5-16.5c0-1.4-2.2-2.5-5-2.5s-5 1.1-5 2.5S9.2 8 12 8s5 1.1 5 2.5-2.2 2.5-5 2.5-5-1.1-5-2.5m10 5c0 1.4-2.2 2.5-5 2.5s-5-1.1-5-2.5" transform="scale(0.92) translate(1 1)" />,
);

export const ReceiptIcon = make(
  "ReceiptIcon",
  <path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21V3zm4 6h6m-6 4h6" />,
);

export const SparkleIcon = make(
  "SparkleIcon",
  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zm7 11l.9 2.4L22 17l-2.1.6L19 20l-.9-2.4L16 17l2.1-.6L19 14z" />,
);

export const EngineIcon = make(
  "EngineIcon",
  <path d="M7 7h5l2 2h3v2h2v-3h2v8h-2v-3h-2v4l-2 2H8l-2-2v-2H4v3H2v-8h2v3h2V9l1-2zm3-4h4v2h-4V3z" strokeWidth={1.6} />,
);

export const BrakeDiscIcon = make(
  "BrakeDiscIcon",
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2M7.4 7.4l1.4 1.4M15.2 15.2l1.4 1.4M16.6 7.4l-1.4 1.4M8.8 15.2l-1.4 1.4" strokeWidth={1.4} />
  </>,
);

export const BatteryIcon = make(
  "BatteryIcon",
  <path d="M7 5V3h4v2m2 0V3h4v2M4 5h16a1 1 0 011 1v13a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm3.5 6h3m-1.5-1.5v3m5 0h3" />,
);

export const SeatIcon = make(
  "SeatIcon",
  <path d="M7 4c1.5 4 1.5 8 1 11h8.5c1 0 2 .8 2 2s-1 2-2 2H8c-1.5 0-2.5-1-3-2.5C4 13 4.5 8 5 4.5 5.2 3.5 6.8 3 7 4z" />,
);

export const WheelIcon = make(
  "WheelIcon",
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 3v6.5M12 14.5V21M3.6 9.3l6.2 2M14.2 12.7l6.2 2M6.8 18.4l4-5M13.2 10.6l4-5" strokeWidth={1.4} />
  </>,
);

export const SuspensionIcon = make(
  "SuspensionIcon",
  <path d="M6 4h12M6 20h12M8 4c4 1.5 4 3 0 4.5s-4 3 0 4.5 4 3 0 4.5S4 19 8 20m8-16c4 1.5 4 3 0 4.5" strokeWidth={1.5} />,
);

export const FanIcon = make(
  "FanIcon",
  <path d="M12 12a2.5 2.5 0 100-.01M12 9.5c0-3.5-1.5-6-4-6-1.8 0-2.5 1.6-1.5 3S9.4 9 12 9.5zm2.2 3.9c3 1.8 5.9 2 7.1-.2.9-1.6-.3-2.9-2-2.9s-3.5.9-5.1 3.1zm-4.4.2c-3 1.8-4.4 4.3-3.1 6.4.9 1.6 2.6 1.3 3.5-.2.9-1.4 1-3.3-.4-6.2z" strokeWidth={1.5} />,
);

export const ExhaustIcon = make(
  "ExhaustIcon",
  <path d="M3 10h11v4H3zM14 11h3l2-2h2m-4 5h2m-6-8v8m-8-8v8m4-8v8" strokeWidth={1.5} />,
);

export const GearboxIcon = make(
  "GearboxIcon",
  <path d="M6 4v16m6-16v8M18 4v4m0 4v8M6 12h12M6 12a2 2 0 100-.01M18 8a2 2 0 100-.01" strokeWidth={1.5} />,
);

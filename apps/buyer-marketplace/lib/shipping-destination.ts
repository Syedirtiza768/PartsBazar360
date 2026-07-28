const STORAGE_KEY = "pb360_shipping_country";

/** Common ISO → shipping-destination labels the rate engine recognizes. */
const ISO_TO_DESTINATION: Record<string, string> = {
  AE: "UAE",
  GB: "United Kingdom",
  SA: "Saudi Arabia",
  US: "United States",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  IN: "India",
  PK: "Pakistan",
  BH: "Bahrain",
  KW: "Kuwait",
  QA: "Qatar",
  OM: "Oman",
};

export function getShippingCountry(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setShippingCountry(country: string) {
  if (typeof window === "undefined") return;
  const next = country.trim();
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, next);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

/** Prefer saved destination; otherwise map geo ISO code when known. */
export function resolveShippingCountry(detectedIso?: string | null): string {
  const saved = getShippingCountry();
  if (saved) return saved;
  if (!detectedIso) return "";
  const code = detectedIso.trim().toUpperCase();
  return ISO_TO_DESTINATION[code] || "";
}

export function tamaraMarket(
  country: string,
): { countryCode: "AE" | "SA"; currency: "AED" | "SAR" } | null {
  const normalized = country
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (["ae", "uae", "unitedarabemirates"].includes(normalized)) {
    return { countryCode: "AE", currency: "AED" };
  }
  if (["sa", "ksa", "saudiarabia"].includes(normalized)) {
    return { countryCode: "SA", currency: "SAR" };
  }
  return null;
}

/**
 * Legal pages serve visitors worldwide, so the country the request came from
 * decides which law and which rights the page talks about. The code comes from
 * the platform's geo headers (Vercel sends x-vercel-ip-country; other proxies
 * use the alternatives below) and is turned into a readable name with
 * Intl.DisplayNames, so no country list has to be maintained by hand.
 */

export type VisitorRegion = {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  /** English display name, e.g. "Nigeria" or "Germany". */
  name: string;
};

/** Country codes that are not real places or that mean "unknown". */
const NOT_A_COUNTRY = new Set(["", "XX", "T1", "A1", "A2", "O1", "EU", "AP", "ZZ"]);

const GEO_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
  "x-geo-country-code",
  "x-appengine-country",
];

/** EU member states plus the EEA, for the GDPR line. */
const EU_EEA = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO",
]);

/** Either a Headers-like object (what next/headers returns) or a plain getter. */
export type HeaderSource =
  | { get(name: string): string | null }
  | ((name: string) => string | null | undefined);

function toGetter(source: HeaderSource) {
  return typeof source === "function"
    ? source
    : (name: string) => source.get(name);
}

export function countryCodeFromHeaders(source: HeaderSource): string | null {
  const getHeader = toGetter(source);
  for (const header of GEO_HEADERS) {
    const value = getHeader(header);
    if (!value) continue;
    const code = value.trim().toUpperCase();
    if (!NOT_A_COUNTRY.has(code)) return code;
  }
  return null;
}

export function countryNameFromCode(code: string): string | null {
  const upper = code.trim().toUpperCase();
  if (NOT_A_COUNTRY.has(upper)) return null;

  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    const name = display.of(upper);
    // Intl echoes the code back when it does not know the region.
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}

/** Names that need "the" in running prose: "the United States", "the Netherlands". */
const NEEDS_ARTICLE = new Set([
  "Bahamas",
  "Central African Republic",
  "Congo - Brazzaville",
  "Congo - Kinshasa",
  "Czechia",
  "Dominican Republic",
  "Gambia",
  "Marshall Islands",
  "Netherlands",
  "Philippines",
  "Solomon Islands",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
]);

export function countryInProse(name: string): string {
  return NEEDS_ARTICLE.has(name) || name.startsWith("United ")
    ? `the ${name}`
    : name;
}

export function regionFromHeaders(source: HeaderSource): VisitorRegion | null {
  const code = countryCodeFromHeaders(source);
  if (!code) return null;
  const name = countryNameFromCode(code);
  if (!name) return null;
  return { code, name };
}

/**
 * The data-protection law that applies where the visitor is, in the wording the
 * page uses. Falls back to the visitor's own country's law when we do not carry
 * a named statute for it.
 */
export function privacyLawFor(region: VisitorRegion | null): string {
  if (!region) return "the data protection law of the country you are visiting from";

  const { code, name } = region;

  if (EU_EEA.has(code)) return "the EU General Data Protection Regulation (GDPR)";
  if (code === "GB") return "the UK General Data Protection Regulation and the Data Protection Act 2018";
  if (code === "CH") return "the Swiss Federal Act on Data Protection";
  if (code === "BR") return "the Brazilian General Data Protection Law (LGPD)";
  if (code === "CA") return "Canada's Personal Information Protection and Electronic Documents Act (PIPEDA)";
  if (code === "AU") return "the Australian Privacy Act";
  if (code === "NZ") return "the New Zealand Privacy Act";
  if (code === "ZA") return "the South African Protection of Personal Information Act (POPIA)";
  if (code === "NG") return "the Nigeria Data Protection Act";
  if (code === "KE") return "the Kenya Data Protection Act";
  if (code === "GH") return "the Ghana Data Protection Act";
  if (code === "IN") return "the Digital Personal Data Protection Act, 2023";
  if (code === "JP") return "the Act on the Protection of Personal Information";
  if (code === "KR") return "the Personal Information Protection Act";
  if (code === "SG") return "the Personal Data Protection Act 2012";
  if (code === "PH") return "the Data Privacy Act of 2012";
  if (code === "ID") return "the Personal Data Protection Law (UU PDP)";
  if (code === "MY") return "the Personal Data Protection Act 2010";
  if (code === "AE" || code === "SA") return "your local data protection law and, where it applies, the GDPR";
  if (code === "US") return "the federal and state privacy laws that apply to you, including the CCPA/CPRA if you are a California resident";

  return `the data protection law of ${name}`;
}

/** The regional advertising opt-out route that actually exists for the visitor. */
export function adOptOutFor(region: VisitorRegion | null): string {
  if (!region) return "the opt-out tools published by the ad partners and the ad settings on your device";
  if (EU_EEA.has(region.code) || region.code === "GB") {
    return "the consent choices we show you and the ad settings on your device";
  }
  if (region.code === "US") {
    return "the opt-out tools published by the ad partners, industry ad-choices portals available in the US, and your device's ad settings";
  }
  if (region.code === "BR") return "the ad settings on your device and the choices the ad partners provide";
  return "the ad settings on your device and the opt-out tools published by the ad partners";
}

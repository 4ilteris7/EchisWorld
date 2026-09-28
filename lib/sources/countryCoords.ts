// Shared country name → approximate centre coordinates.
// Used by all news API adapters for item_location marker placement.

import { worldCapitals } from "@/data/worldCapitals";

const MANUAL_COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  Afghanistan: { lat: 33.93, lng: 67.71 },
  Albania: { lat: 41.15, lng: 20.17 },
  Algeria: { lat: 28.03, lng: 1.66 },
  Angola: { lat: -11.2, lng: 17.87 },
  Argentina: { lat: -38.42, lng: -63.62 },
  Armenia: { lat: 40.07, lng: 45.04 },
  Australia: { lat: -25.27, lng: 133.78 },
  Austria: { lat: 47.52, lng: 14.55 },
  Azerbaijan: { lat: 40.14, lng: 47.58 },
  Bangladesh: { lat: 23.68, lng: 90.36 },
  Belarus: { lat: 53.71, lng: 27.95 },
  Belgium: { lat: 50.5, lng: 4.47 },
  Bolivia: { lat: -16.29, lng: -63.59 },
  Brazil: { lat: -14.24, lng: -51.93 },
  Myanmar: { lat: 21.92, lng: 95.96 },
  Burma: { lat: 21.92, lng: 95.96 },
  Burundi: { lat: -3.37, lng: 29.92 },
  Cambodia: { lat: 12.57, lng: 104.99 },
  Cameroon: { lat: 7.37, lng: 12.35 },
  "Central African Republic": { lat: 6.61, lng: 20.94 },
  Chad: { lat: 15.45, lng: 18.73 },
  Chile: { lat: -35.68, lng: -71.54 },
  China: { lat: 35.86, lng: 104.19 },
  Colombia: { lat: 4.57, lng: -74.3 },
  Cuba: { lat: 21.52, lng: -77.78 },
  Czechia: { lat: 49.82, lng: 15.47 },
  "Czech Republic": { lat: 49.82, lng: 15.47 },
  Egypt: { lat: 26.82, lng: 30.8 },
  Ethiopia: { lat: 9.15, lng: 40.49 },
  Finland: { lat: 64.96, lng: 25.75 },
  France: { lat: 46.23, lng: 2.21 },
  Georgia: { lat: 42.32, lng: 43.36 },
  Germany: { lat: 51.17, lng: 10.45 },
  Ghana: { lat: 7.95, lng: -1.02 },
  Greece: { lat: 39.07, lng: 21.82 },
  Guatemala: { lat: 15.78, lng: -90.23 },
  Guinea: { lat: 9.95, lng: -11.49 },
  Haiti: { lat: 18.97, lng: -72.29 },
  Honduras: { lat: 15.2, lng: -86.24 },
  Hungary: { lat: 47.16, lng: 19.5 },
  India: { lat: 20.59, lng: 78.96 },
  Indonesia: { lat: -0.79, lng: 113.92 },
  Iran: { lat: 32.43, lng: 53.69 },
  Iraq: { lat: 33.22, lng: 43.68 },
  Israel: { lat: 31.05, lng: 34.85 },
  Italy: { lat: 41.87, lng: 12.57 },
  Japan: { lat: 36.2, lng: 138.25 },
  Jordan: { lat: 30.59, lng: 36.24 },
  Kazakhstan: { lat: 48.02, lng: 66.92 },
  Kenya: { lat: -0.02, lng: 37.91 },
  Kosovo: { lat: 42.6, lng: 20.9 },
  Kuwait: { lat: 29.31, lng: 47.48 },
  Lebanon: { lat: 33.85, lng: 35.86 },
  Libya: { lat: 26.34, lng: 17.23 },
  Malaysia: { lat: 4.21, lng: 108.05 },
  Mali: { lat: 17.57, lng: -3.99 },
  Mexico: { lat: 23.63, lng: -102.55 },
  Moldova: { lat: 47.41, lng: 28.37 },
  Morocco: { lat: 31.79, lng: -7.09 },
  Mozambique: { lat: -18.67, lng: 35.53 },
  Nepal: { lat: 28.39, lng: 84.12 },
  Netherlands: { lat: 52.13, lng: 5.29 },
  Niger: { lat: 17.61, lng: 8.08 },
  Nigeria: { lat: 9.08, lng: 8.68 },
  "North Korea": { lat: 40.34, lng: 127.51 },
  Norway: { lat: 60.47, lng: 8.47 },
  Pakistan: { lat: 30.38, lng: 69.35 },
  Palestine: { lat: 31.95, lng: 35.23 },
  Peru: { lat: -9.19, lng: -75.02 },
  Philippines: { lat: 12.88, lng: 121.77 },
  Poland: { lat: 51.92, lng: 19.15 },
  Qatar: { lat: 25.35, lng: 51.18 },
  Romania: { lat: 45.94, lng: 24.97 },
  Russia: { lat: 61.52, lng: 105.32 },
  Rwanda: { lat: -1.94, lng: 29.87 },
  "Saudi Arabia": { lat: 23.89, lng: 45.08 },
  Serbia: { lat: 44.02, lng: 21.01 },
  Somalia: { lat: 5.15, lng: 46.2 },
  "South Africa": { lat: -30.56, lng: 22.94 },
  "South Korea": { lat: 35.91, lng: 127.77 },
  "South Sudan": { lat: 6.88, lng: 31.31 },
  Spain: { lat: 40.46, lng: -3.75 },
  Sudan: { lat: 12.86, lng: 30.22 },
  Sweden: { lat: 60.13, lng: 18.64 },
  Switzerland: { lat: 46.82, lng: 8.23 },
  Syria: { lat: 34.8, lng: 38.99 },
  Taiwan: { lat: 23.7, lng: 120.96 },
  Thailand: { lat: 15.87, lng: 100.99 },
  Turkey: { lat: 38.96, lng: 35.24 },
  Türkiye: { lat: 38.96, lng: 35.24 },
  Uganda: { lat: 1.37, lng: 32.29 },
  Ukraine: { lat: 48.38, lng: 31.17 },
  "United Arab Emirates": { lat: 23.42, lng: 53.85 },
  "United Kingdom": { lat: 55.38, lng: -3.44 },
  "United States": { lat: 37.09, lng: -95.71 },
  Uzbekistan: { lat: 41.38, lng: 64.59 },
  Venezuela: { lat: 6.42, lng: -66.59 },
  Vietnam: { lat: 14.06, lng: 108.28 },
  Yemen: { lat: 15.55, lng: 48.52 },
  Zimbabwe: { lat: -19.02, lng: 29.15 },
};

const WORLD_CAPITAL_COUNTRY_COORDS: Record<string, { lat: number; lng: number }> =
  Object.fromEntries(
    worldCapitals.map((entry) => [
      entry.country,
      { lat: entry.coordinates[1], lng: entry.coordinates[0] },
    ]),
  );

export const COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  ...WORLD_CAPITAL_COUNTRY_COORDS,
  ...MANUAL_COUNTRY_COORDS,
};

// Sorted long-to-short so multi-word names match before their fragments.
export const COUNTRY_NAMES_SORTED = Object.keys(COUNTRY_COORDS).sort(
  (a, b) => b.length - a.length,
);

export function extractCountriesFromText(text: string): string[] {
  const found: string[] = [];
  for (const name of COUNTRY_NAMES_SORTED) {
    if (
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
    ) {
      found.push(name);
    }
  }
  return found;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

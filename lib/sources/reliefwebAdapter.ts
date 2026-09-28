import https from "https";
import type {
  NormalizedSourceItem,
  SourceDefinition,
} from "@/data/sources/sourceTypes";

const FETCH_TIMEOUT_MS = 12_000;

const RELIEFWEB_API_URL =
  "https://api.reliefweb.int/v2/reports?appname=echis";

const RELIEFWEB_REQUEST_BODY = {
  fields: {
    include: [
      "title",
      "body",
      "url_alias",
      "date.created",
      "country.name",
      "country.iso3",
      "source.name",
      "primary_country.name",
      "primary_country.iso3",
    ],
  },
  filter: {
    operator: "OR",
    conditions: [
      {
        field: "theme",
        value: ["Security", "Peace and Governance", "Protection and Human Rights"],
      },
      {
        field: "disaster_type",
        value: ["Complex Emergency"],
      },
    ],
  },
  sort: ["date.created:desc"],
  limit: 50,
};

const COUNTRY_NAME_TO_COORDS: Record<string, { lat: number; lng: number }> = {
  Afghanistan: { lat: 33.93, lng: 67.71 },
  Albania: { lat: 41.15, lng: 20.17 },
  Algeria: { lat: 28.03, lng: 1.66 },
  Angola: { lat: -11.2, lng: 17.87 },
  Argentina: { lat: -38.42, lng: -63.62 },
  Armenia: { lat: 40.07, lng: 45.04 },
  Azerbaijan: { lat: 40.14, lng: 47.58 },
  Bangladesh: { lat: 23.68, lng: 90.36 },
  Belarus: { lat: 53.71, lng: 27.95 },
  Bolivia: { lat: -16.29, lng: -63.59 },
  "Bosnia and Herzegovina": { lat: 43.92, lng: 17.68 },
  Brazil: { lat: -14.24, lng: -51.93 },
  Burma: { lat: 21.92, lng: 95.96 },
  Myanmar: { lat: 21.92, lng: 95.96 },
  Burundi: { lat: -3.37, lng: 29.92 },
  Cambodia: { lat: 12.57, lng: 104.99 },
  Cameroon: { lat: 7.37, lng: 12.35 },
  "Central African Republic": { lat: 6.61, lng: 20.94 },
  Chad: { lat: 15.45, lng: 18.73 },
  China: { lat: 35.86, lng: 104.19 },
  Colombia: { lat: 4.57, lng: -74.3 },
  "Congo, Democratic Republic of the": { lat: -4.04, lng: 21.76 },
  "Congo, Republic of the": { lat: -0.23, lng: 15.83 },
  Cuba: { lat: 21.52, lng: -77.78 },
  Cyprus: { lat: 35.13, lng: 33.43 },
  Djibouti: { lat: 11.83, lng: 42.59 },
  Ecuador: { lat: -1.83, lng: -78.18 },
  Egypt: { lat: 26.82, lng: 30.8 },
  "El Salvador": { lat: 13.79, lng: -88.9 },
  Eritrea: { lat: 15.18, lng: 39.78 },
  Ethiopia: { lat: 9.15, lng: 40.49 },
  Georgia: { lat: 42.32, lng: 43.36 },
  Guatemala: { lat: 15.78, lng: -90.23 },
  Guinea: { lat: 9.95, lng: -11.49 },
  Haiti: { lat: 18.97, lng: -72.29 },
  Honduras: { lat: 15.2, lng: -86.24 },
  India: { lat: 20.59, lng: 78.96 },
  Indonesia: { lat: -0.79, lng: 113.92 },
  Iran: { lat: 32.43, lng: 53.69 },
  Iraq: { lat: 33.22, lng: 43.68 },
  Israel: { lat: 31.05, lng: 34.85 },
  Jordan: { lat: 30.59, lng: 36.24 },
  Kazakhstan: { lat: 48.02, lng: 66.92 },
  Kenya: { lat: -0.02, lng: 37.91 },
  Kosovo: { lat: 42.6, lng: 20.9 },
  Kyrgyzstan: { lat: 41.2, lng: 74.76 },
  Laos: { lat: 19.86, lng: 102.5 },
  Lebanon: { lat: 33.85, lng: 35.86 },
  Liberia: { lat: 6.43, lng: -9.43 },
  Libya: { lat: 26.34, lng: 17.23 },
  Mali: { lat: 17.57, lng: -3.99 },
  Mauritania: { lat: 21.01, lng: -10.94 },
  Mexico: { lat: 23.63, lng: -102.55 },
  Moldova: { lat: 47.41, lng: 28.37 },
  Morocco: { lat: 31.79, lng: -7.09 },
  Mozambique: { lat: -18.67, lng: 35.53 },
  Nepal: { lat: 28.39, lng: 84.12 },
  Nicaragua: { lat: 12.87, lng: -85.21 },
  Niger: { lat: 17.61, lng: 8.08 },
  Nigeria: { lat: 9.08, lng: 8.68 },
  "North Korea": { lat: 40.34, lng: 127.51 },
  Pakistan: { lat: 30.38, lng: 69.35 },
  Palestine: { lat: 31.95, lng: 35.23 },
  "Palestinian Territory": { lat: 31.95, lng: 35.23 },
  Peru: { lat: -9.19, lng: -75.02 },
  Philippines: { lat: 12.88, lng: 121.77 },
  Russia: { lat: 61.52, lng: 105.32 },
  Rwanda: { lat: -1.94, lng: 29.87 },
  "Saudi Arabia": { lat: 23.89, lng: 45.08 },
  Senegal: { lat: 14.5, lng: -14.45 },
  "Sierra Leone": { lat: 8.46, lng: -11.78 },
  Somalia: { lat: 5.15, lng: 46.2 },
  "South Sudan": { lat: 6.88, lng: 31.31 },
  Sudan: { lat: 12.86, lng: 30.22 },
  Syria: { lat: 34.8, lng: 38.99 },
  Tajikistan: { lat: 38.86, lng: 71.28 },
  Tanzania: { lat: -6.37, lng: 34.89 },
  Thailand: { lat: 15.87, lng: 100.99 },
  Turkey: { lat: 38.96, lng: 35.24 },
  Türkiye: { lat: 38.96, lng: 35.24 },
  Turkmenistan: { lat: 38.97, lng: 59.56 },
  Uganda: { lat: 1.37, lng: 32.29 },
  Ukraine: { lat: 48.38, lng: 31.17 },
  "United Arab Emirates": { lat: 23.42, lng: 53.85 },
  "United States": { lat: 37.09, lng: -95.71 },
  Uzbekistan: { lat: 41.38, lng: 64.59 },
  Venezuela: { lat: 6.42, lng: -66.59 },
  Vietnam: { lat: 14.06, lng: 108.28 },
  Yemen: { lat: 15.55, lng: 48.52 },
  Zambia: { lat: -13.13, lng: 27.85 },
  Zimbabwe: { lat: -19.02, lng: 29.15 },
};

interface ReliefWebReportFields {
  title?: string;
  body?: string;
  url_alias?: string;
  date?: { created?: string };
  country?: Array<{ name?: string; iso3?: string }>;
  source?: Array<{ name?: string }>;
  primary_country?: { name?: string; iso3?: string };
}

interface ReliefWebReport {
  id: number;
  fields: ReliefWebReportFields;
}

interface ReliefWebApiResponse {
  data?: ReliefWebReport[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Make a POST request using Node.js built-in https module.
 * The undici-backed global fetch used by Next.js App Router has a TLS
 * fingerprint that triggers the HDX WAF on api.reliefweb.int.
 * The native https module uses a different fingerprint and passes through.
 */
function httpsPost(
  url: string,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("AbortError"));
    });
    req.on("error", (err) => {
      if (err.message === "AbortError") {
        const abort = new Error("Request timed out");
        abort.name = "AbortError";
        reject(abort);
      } else {
        reject(err);
      }
    });
    req.write(body);
    req.end();
  });
}

export async function fetchReliefWebReports(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  const bodyStr = JSON.stringify(RELIEFWEB_REQUEST_BODY);

  const { status, text } = await httpsPost(
    RELIEFWEB_API_URL,
    bodyStr,
    FETCH_TIMEOUT_MS,
  );

  if (status < 200 || status >= 300) {
    let detail = "";
    try {
      const match = /"message"\s*:\s*"([^"]{1,200})"/.exec(text);
      detail = match ? match[1] : text.slice(0, 120);
    } catch {
      // ignore
    }
    throw new Error(`upstream_${status}${detail ? `: ${detail}` : ""}`);
  }

  let data: ReliefWebApiResponse;
  try {
    data = JSON.parse(text) as ReliefWebApiResponse;
  } catch {
    throw new Error("parse_failed");
  }

  const reports = data.data;
  if (!Array.isArray(reports) || reports.length === 0) {
    return [];
  }

  const collectedAt = new Date().toISOString();
  const items: NormalizedSourceItem[] = [];

  for (const report of reports) {
    const fields = report.fields ?? {};

    const title = (fields.title ?? "").trim();
    if (!title) continue;

    const rawBody = fields.body ?? "";
    const stripped = stripHtml(rawBody);
    const summary = stripped;

    const urlAlias = fields.url_alias ?? "";
    const url = urlAlias ? `https://reliefweb.int${urlAlias}` : "";
    if (!url) continue;

    const publishedAt = fields.date?.created ?? "";

    const relatedCountries = Array.isArray(fields.country)
      ? fields.country
          .map((c) => c.name ?? "")
          .filter(Boolean)
      : [];

    const primaryCountryName = fields.primary_country?.name ?? "";
    const coords = primaryCountryName
      ? COUNTRY_NAME_TO_COORDS[primaryCountryName]
      : undefined;

    const sourceNameSuffix =
      Array.isArray(fields.source) && fields.source[0]?.name
        ? fields.source[0].name
        : "ReliefWeb";

    const id = `${source.id}::${report.id}`;

    items.push({
      id,
      sourceId: source.id,
      sourceName: `ReliefWeb — ${sourceNameSuffix}`,
      title,
      summary,
      url,
      publishedAt,
      collectedAt,
      sourceType: "api",
      sourceStatus: source.sourceStatus,
      verificationStatus: "multi_source_reference",
      sourceBasis: "multiple_public_sources",
      extractionMethod: "api_result",
      sourceLanguage: "en",
      relatedCountries,
      relatedRegions: [source.regionScope],
      category: source.category,
      isSample: false,
      sourceProfile: "conflict_crisis",
      markerLocationStrategy: "item_location",
      ...(primaryCountryName && coords
        ? {
            sourceLocationForMarker: {
              lat: coords.lat,
              lng: coords.lng,
              locationName: primaryCountryName,
            },
          }
        : {}),
    });
  }

  return items;
}

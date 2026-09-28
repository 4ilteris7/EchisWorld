import { NextResponse, type NextRequest } from "next/server";

type ClientTimezoneResponse = {
  timezone: string;
  city: string | null;
  region: string | null;
  country: string | null;
  source: "findip" | "fallback";
};

type CacheEntry = {
  expiresAt: number;
  payload: ClientTimezoneResponse;
};

const FALLBACK_RESPONSE: ClientTimezoneResponse = {
  timezone: "UTC",
  city: null,
  region: null,
  country: null,
  source: "fallback",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FINDIP_TIMEOUT_MS = 3500;
/** Hard cap so an IP-scanning client cannot grow the cache unbounded. */
const CACHE_MAX_ENTRIES = 5000;
const timezoneCache = new Map<string, CacheEntry>();

function getFirstHeaderIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? normalizeIp(first) : null;
}

function normalizeIp(ip: string): string {
  if (ip.startsWith("[") && ip.includes("]")) {
    return ip.slice(1, ip.indexOf("]"));
  }

  const lastColonIndex = ip.lastIndexOf(":");
  if (
    lastColonIndex > -1 &&
    ip.indexOf(":") === lastColonIndex &&
    /^\d+$/.test(ip.slice(lastColonIndex + 1))
  ) {
    return ip.slice(0, lastColonIndex);
  }

  return ip;
}

function detectPublicIp(request: NextRequest): string | null {
  const candidates = [
    getFirstHeaderIp(request.headers.get("cf-connecting-ip")),
    getFirstHeaderIp(request.headers.get("x-forwarded-for")),
    getFirstHeaderIp(request.headers.get("x-real-ip")),
  ];

  const detectedIp = candidates.find((ip) => ip !== null);
  if (!detectedIp || isLocalOrPrivateIp(detectedIp)) return null;

  return detectedIp;
}

function getDevelopmentOverrideIp(): string | null {
  if (process.env.NODE_ENV === "production") return null;

  const devIp = process.env.FINDIP_DEV_IP?.trim();
  if (!devIp) return null;

  const normalized = normalizeIp(devIp);
  return isLocalOrPrivateIp(normalized) ? null : normalized;
}

function isLocalOrPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function countryName(value: unknown): string | null {
  if (typeof value === "string") return stringField(value);
  if (!isRecord(value)) return null;

  const names = value.names;
  if (isRecord(names)) {
    return (
      stringField(names.en) ??
      stringField(Object.values(names).find((entry) => typeof entry === "string"))
    );
  }

  return stringField(value.name) ?? stringField(value.iso_code);
}

function placeName(value: unknown): string | null {
  if (typeof value === "string") return stringField(value);
  if (!isRecord(value)) return null;

  const names = value.names;
  if (isRecord(names)) {
    return (
      stringField(names.en) ??
      stringField(Object.values(names).find((entry) => typeof entry === "string"))
    );
  }

  return stringField(value.name);
}

function regionName(data: Record<string, unknown>): string | null {
  if (Array.isArray(data.subdivisions)) {
    const firstSubdivision = data.subdivisions.find(isRecord);
    const subdivisionName = placeName(firstSubdivision);
    if (subdivisionName) return subdivisionName;
  }

  const location = isRecord(data.location) ? data.location : null;

  return (
    placeName(data.subdivision) ??
    placeName(data.region) ??
    placeName(location?.subdivision) ??
    placeName(location?.region) ??
    placeName(location?.state)
  );
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function fetchFindIpTimezone(ip: string): Promise<ClientTimezoneResponse> {
  const token = process.env.FINDIP_API_KEY;
  if (!token) return FALLBACK_RESPONSE;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINDIP_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.findip.net/${encodeURIComponent(ip)}/?token=${encodeURIComponent(token)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) return FALLBACK_RESPONSE;

    const data: unknown = await response.json();
    if (!isRecord(data) || !isRecord(data.location)) return FALLBACK_RESPONSE;

    const timezone = stringField(data.location.time_zone);
    if (!timezone || !isValidTimeZone(timezone)) return FALLBACK_RESPONSE;

    return {
      timezone,
      city: stringField(data.city) ?? stringField(data.location.city),
      region: regionName(data),
      country: countryName(data.country) ?? countryName(data.location.country),
      source: "findip",
    };
  } catch {
    return FALLBACK_RESPONSE;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const ip = detectPublicIp(request) ?? getDevelopmentOverrideIp();
  if (!ip) {
    return NextResponse.json(FALLBACK_RESPONSE);
  }

  const cached = timezoneCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  const payload = await fetchFindIpTimezone(ip);
  if (timezoneCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = timezoneCache.keys().next().value;
    if (oldestKey !== undefined) timezoneCache.delete(oldestKey);
  }
  timezoneCache.set(ip, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });

  return NextResponse.json(payload);
}

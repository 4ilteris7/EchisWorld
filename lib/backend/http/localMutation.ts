const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Personal-source mutation is intentionally available only on local installs. */
export function rejectNonLocalMutation(request: Request): Response | null {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = forwardedHost || request.headers.get("host") || requestUrl.host;
  let hostname = "";
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return Response.json({ error: "invalid_host" }, { status: 403 });
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return Response.json(
      { error: "personal_sources_local_only" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== hostHeader) {
        return Response.json(
          { error: "cross_origin_mutation_blocked" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    } catch {
      return Response.json({ error: "invalid_origin" }, { status: 403 });
    }
  }
  return null;
}

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import { rejectNonLocalMutation } from "@/lib/backend/http/localMutation";
import {
  createPersonalSource,
  deletePersonalSource,
  listPersonalSources,
  personalSourceToIntelDefinition,
  setPersonalSourceEnabled,
} from "@/lib/backend/sources/personalSources";
import {
  parsePersonalSourceDraft,
  probePersonalSource,
} from "@/lib/backend/sources/personalSourceValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, { bucket: "personal-sources-read", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const sources = await listPersonalSources(getPool("web"));
    return Response.json({
      sources: sources.map((personal) => ({
        personal,
        definition: personalSourceToIntelDefinition(personal),
      })),
    }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "storage_unreachable" }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: Request): Promise<Response> {
  const localOnly = rejectNonLocalMutation(request);
  if (localOnly) return localOnly;
  const limited = rateLimit(request, { bucket: "personal-sources-write", limit: 8, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const draft = parsePersonalSourceDraft(await request.json());
    const probe = await probePersonalSource(draft);
    const source = await createPersonalSource(getPool("web"), {
      ...draft,
      validationItemCount: probe.itemCount,
    });
    return Response.json({
      source: { personal: source, definition: personalSourceToIntelDefinition(source) },
      probe,
    }, { status: 201, headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "create_failed";
    const duplicate = /duplicate key/i.test(code);
    return Response.json(
      { error: duplicate ? "source_already_exists" : code },
      { status: duplicate ? 409 : 400, headers: NO_STORE },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const localOnly = rejectNonLocalMutation(request);
  if (localOnly) return localOnly;
  const limited = rateLimit(request, { bucket: "personal-sources-write", limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const input = await request.json() as Record<string, unknown>;
    const sourceId = typeof input.sourceId === "string" ? input.sourceId : "";
    if (!/^personal-[0-9a-f-]{36}$/.test(sourceId) || typeof input.enabled !== "boolean") {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const source = await setPersonalSourceEnabled(getPool("web"), sourceId, input.enabled);
    if (!source) return Response.json({ error: "source_not_found" }, { status: 404, headers: NO_STORE });
    return Response.json({ personal: source, definition: personalSourceToIntelDefinition(source) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "update_failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const localOnly = rejectNonLocalMutation(request);
  if (localOnly) return localOnly;
  const limited = rateLimit(request, { bucket: "personal-sources-write", limit: 12, windowMs: 60_000 });
  if (limited) return limited;
  const sourceId = new URL(request.url).searchParams.get("sourceId") ?? "";
  if (!/^personal-[0-9a-f-]{36}$/.test(sourceId)) {
    return Response.json({ error: "invalid_source_id" }, { status: 400, headers: NO_STORE });
  }
  try {
    const removed = await deletePersonalSource(getPool("web"), sourceId);
    return removed
      ? new Response(null, { status: 204, headers: NO_STORE })
      : Response.json({ error: "source_not_found" }, { status: 404, headers: NO_STORE });
  } catch {
    return Response.json({ error: "delete_failed" }, { status: 500, headers: NO_STORE });
  }
}


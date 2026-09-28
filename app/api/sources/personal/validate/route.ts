import { rateLimit } from "@/lib/backend/http/rateLimit";
import { rejectNonLocalMutation } from "@/lib/backend/http/localMutation";
import {
  parsePersonalSourceDraft,
  probePersonalSource,
} from "@/lib/backend/sources/personalSourceValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const localOnly = rejectNonLocalMutation(request);
  if (localOnly) return localOnly;
  const limited = rateLimit(request, { bucket: "personal-source-validate", limit: 12, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const draft = parsePersonalSourceDraft(await request.json());
    const probe = await probePersonalSource(draft);
    return Response.json({ ok: true, probe }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "validation_failed";
    const status = code.startsWith("upstream_") ? 422 : 400;
    return Response.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}


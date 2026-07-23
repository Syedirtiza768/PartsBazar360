import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * On-demand ISR / Data Cache invalidation for PDP tags.
 * Called by the Nest API after merchant offer edits (shared secret).
 *
 * POST /buyer/api/revalidate/
 * Headers: x-revalidate-secret: <REVALIDATE_SECRET>
 * Body: { tag?: string, partId?: string, path?: string }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "revalidate disabled" }, { status: 503 });
  }

  const provided = req.headers.get("x-revalidate-secret");
  if (!provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { tag?: string; partId?: string; path?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const tag = body.tag || (body.partId ? `part:${body.partId}` : null);
  const path = body.path || (body.partId ? `/part/${body.partId}` : null);

  if (tag) revalidateTag(tag, { expire: 0 });
  if (path) revalidatePath(path);

  return NextResponse.json({ ok: true, tag, path });
}

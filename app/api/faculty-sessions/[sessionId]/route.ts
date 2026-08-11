import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { sessionId } = await params;
  const { hours, rate, paid } = await req.json();

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (hours !== undefined) { sets.push(`hours = $${i++}`); values.push(hours); }
  if (rate !== undefined) { sets.push(`rate = $${i++}`); values.push(rate); }
  if (paid !== undefined) { sets.push(`paid = $${i++}`); values.push(paid); }
  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  values.push(sessionId);
  const res = await query(`UPDATE faculty_sessions SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, session_date, topic, hours, rate, paid`, values);
  if (res.rows.length === 0) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  await logAudit(session.id, session.name, "faculty_sessions", sessionId, paid !== undefined ? `Marked payout entry as ${paid ? "paid" : "unpaid"}` : "Updated payout entry");
  return NextResponse.json({ session: res.rows[0] });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { sessionId } = await params;

  await query("DELETE FROM faculty_sessions WHERE id = $1", [sessionId]);
  await logAudit(session.id, session.name, "faculty_sessions", sessionId, "Removed a payout entry");
  return NextResponse.json({ ok: true });
}

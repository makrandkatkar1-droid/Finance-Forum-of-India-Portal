import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { eventId } = await params;

  const res = await query(
    `SELECT student_roster_id, present FROM event_attendance WHERE event_id = $1`,
    [eventId]
  );

  const records: Record<string, boolean> = {};
  for (const row of res.rows) records[row.student_roster_id] = row.present;

  return NextResponse.json({ records });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { eventId } = await params;

  const { studentRosterId, present } = await req.json();
  if (!studentRosterId || present === undefined) {
    return NextResponse.json({ error: "studentRosterId and present are required." }, { status: 400 });
  }

  await query(
    `INSERT INTO event_attendance (event_id, student_roster_id, present, marked_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id, student_roster_id)
     DO UPDATE SET present = EXCLUDED.present, marked_by = EXCLUDED.marked_by, marked_at = now()`,
    [eventId, studentRosterId, present, session.id]
  );

  await logAudit(session.id, session.name, "event_attendance", eventId, `Marked event attendance (${present ? "present" : "absent"})`);
  return NextResponse.json({ ok: true });
}

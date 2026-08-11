import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { sessionId, studentRosterId, present } = await req.json();
  if (!sessionId || !studentRosterId || present === undefined) {
    return NextResponse.json({ error: "sessionId, studentRosterId, and present are required." }, { status: 400 });
  }

  await query(
    `INSERT INTO attendance_records (session_id, student_roster_id, present, marked_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (session_id, student_roster_id)
     DO UPDATE SET present = EXCLUDED.present, marked_by = EXCLUDED.marked_by, marked_at = now()`,
    [sessionId, studentRosterId, present, session.id]
  );

  await logAudit(session.id, session.name, "attendance_records", studentRosterId, `Marked attendance (${present ? "present" : "absent"})`);
  return NextResponse.json({ ok: true });
}

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

  const { sessionDate } = await req.json();
  if (!sessionDate) return NextResponse.json({ error: "sessionDate is required." }, { status: 400 });

  const res = await query(
    `INSERT INTO attendance_sessions (course_id, session_date, created_by) VALUES ($1,$2,$3) RETURNING id, session_date`,
    [courseId, sessionDate, session.id]
  );

  await logAudit(session.id, session.name, "attendance_sessions", res.rows[0].id, `Added a lecture session`);
  return NextResponse.json({ session: res.rows[0] }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required." }, { status: 400 });

  await query("DELETE FROM attendance_sessions WHERE id = $1 AND course_id = $2", [id, courseId]);
  await logAudit(session.id, session.name, "attendance_sessions", id, "Removed a lecture session");
  return NextResponse.json({ ok: true });
}

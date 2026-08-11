import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (session.role === "student") return NextResponse.json({ error: "Students cannot edit marks." }, { status: 403 });
  const { courseId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { studentRosterId, marks } = await req.json();
  if (!studentRosterId || marks === undefined) {
    return NextResponse.json({ error: "studentRosterId and marks are required." }, { status: 400 });
  }
  const clamped = Math.max(0, Math.min(50, Number(marks)));

  await query(
    `INSERT INTO summative_marks (course_id, student_roster_id, marks_obtained, graded_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (course_id, student_roster_id)
     DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, graded_by = EXCLUDED.graded_by, graded_at = now()`,
    [courseId, studentRosterId, clamped, session.id]
  );

  await logAudit(session.id, session.name, "summative_marks", studentRosterId, `Recorded external/summative marks`);
  return NextResponse.json({ ok: true, marks: clamped });
}

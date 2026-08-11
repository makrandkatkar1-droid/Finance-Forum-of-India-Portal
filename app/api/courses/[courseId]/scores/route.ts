import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  if (session.role === "student") {
    return NextResponse.json({ error: "Students cannot view or edit marks." }, { status: 403 });
  }
  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { studentRosterId, componentId, marks } = await req.json();
  if (!studentRosterId || !componentId || marks === undefined) {
    return NextResponse.json({ error: "studentRosterId, componentId, and marks are required." }, { status: 400 });
  }

  const compRes = await query("SELECT max_marks FROM assessment_components WHERE id = $1 AND course_id = $2", [componentId, courseId]);
  if (compRes.rows.length === 0) return NextResponse.json({ error: "Component not found." }, { status: 404 });
  const maxMarks = compRes.rows[0].max_marks;
  const clamped = Math.max(0, Math.min(maxMarks, Number(marks)));

  await query(
    `INSERT INTO student_scores (student_roster_id, component_id, marks_obtained, graded_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (student_roster_id, component_id)
     DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, graded_by = EXCLUDED.graded_by, graded_at = now()`,
    [studentRosterId, componentId, clamped, session.id]
  );

  await logAudit(session.id, session.name, "student_scores", componentId, `Recorded marks for a student`);
  return NextResponse.json({ ok: true, marks: clamped });
}

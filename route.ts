import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  const courseRes = await query(
    `SELECT c.id, c.name, c.code, c.day_allocated, c.day_parity, c.total_hours, c.batch_id, c.results_published, u.name AS faculty_name
     FROM courses c JOIN users u ON u.id = c.faculty_id WHERE c.id = $1`,
    [courseId]
  );
  if (courseRes.rows.length === 0) return NextResponse.json({ error: "Course not found." }, { status: 404 });

  const [modules, weeklyPlans, assignments, tests, components, attendanceSessions] = await Promise.all([
    query("SELECT id, module_number, module_name, status, completed_date FROM modules WHERE course_id = $1 ORDER BY module_number", [courseId]),
    query("SELECT id, week_number, week_start_date, session_type, activity_name, topics, module_id FROM weekly_plans WHERE course_id = $1 ORDER BY week_start_date", [courseId]),
    query("SELECT id, title, description, deadline FROM assignments WHERE course_id = $1 ORDER BY deadline", [courseId]),
    query("SELECT id, test_type, test_date FROM tests WHERE course_id = $1 ORDER BY test_date", [courseId]),
    query("SELECT id, component_name, max_marks, display_order FROM assessment_components WHERE course_id = $1 ORDER BY display_order", [courseId]),
    query("SELECT id, session_date FROM attendance_sessions WHERE course_id = $1 ORDER BY session_date", [courseId]),
  ]);

  let scores: Record<string, Record<string, number>> = {};
  let summativeMarks: Record<string, number> = {};
  let attendanceRecords: Record<string, Record<string, boolean>> = {};

  const showFullData = session.role !== "student";
  const showOwnPublishedData = session.role === "student" && courseRes.rows[0].results_published && session.studentId;

  if (showFullData || showOwnPublishedData) {
    const componentIds = components.rows.map((c) => c.id);
    if (componentIds.length > 0) {
      const scoresRes = showFullData
        ? await query(`SELECT student_roster_id, component_id, marks_obtained FROM student_scores WHERE component_id = ANY($1::uuid[])`, [componentIds])
        : await query(`SELECT student_roster_id, component_id, marks_obtained FROM student_scores WHERE component_id = ANY($1::uuid[]) AND student_roster_id = $2`, [componentIds, session.studentId]);
      for (const row of scoresRes.rows) {
        if (!scores[row.student_roster_id]) scores[row.student_roster_id] = {};
        scores[row.student_roster_id][row.component_id] = Number(row.marks_obtained);
      }
    }

    const summRes = showFullData
      ? await query(`SELECT student_roster_id, marks_obtained FROM summative_marks WHERE course_id = $1`, [courseId])
      : await query(`SELECT student_roster_id, marks_obtained FROM summative_marks WHERE course_id = $1 AND student_roster_id = $2`, [courseId, session.studentId]);
    for (const row of summRes.rows) summativeMarks[row.student_roster_id] = Number(row.marks_obtained);

    const sessionIds = attendanceSessions.rows.map((s) => s.id);
    if (sessionIds.length > 0) {
      const recRes = showFullData
        ? await query(`SELECT session_id, student_roster_id, present FROM attendance_records WHERE session_id = ANY($1::uuid[])`, [sessionIds])
        : await query(`SELECT session_id, student_roster_id, present FROM attendance_records WHERE session_id = ANY($1::uuid[]) AND student_roster_id = $2`, [sessionIds, session.studentId]);
      for (const row of recRes.rows) {
        if (!attendanceRecords[row.student_roster_id]) attendanceRecords[row.student_roster_id] = {};
        attendanceRecords[row.student_roster_id][row.session_id] = row.present;
      }
    }
  }

  const canEdit = await canEditCourse(session, courseId);

  return NextResponse.json({
    course: courseRes.rows[0],
    modules: modules.rows,
    weeklyPlans: weeklyPlans.rows,
    assignments: assignments.rows,
    tests: tests.rows,
    components: components.rows,
    scores,
    summativeMarks,
    attendanceSessions: attendanceSessions.rows,
    attendanceRecords,
    canEdit,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { dayAllocated, dayParity, resultsPublished } = await req.json();
  const res = await query(
    `UPDATE courses SET
       day_allocated = COALESCE($1, day_allocated),
       day_parity = CASE WHEN $5::boolean THEN $2 ELSE day_parity END,
       results_published = COALESCE($3, results_published)
     WHERE id = $4 RETURNING id, name, day_allocated, day_parity, results_published`,
    [dayAllocated ?? null, dayParity ?? null, resultsPublished === undefined ? null : resultsPublished, courseId, dayParity !== undefined]
  );

  if (res.rows.length === 0) return NextResponse.json({ error: "Course not found." }, { status: 404 });

  const action = resultsPublished !== undefined
    ? `${resultsPublished ? "Published" : "Unpublished"} results for ${res.rows[0].name}`
    : `Updated schedule for ${res.rows[0].name}`;
  await logAudit(session.id, session.name, "courses", courseId, action);
  return NextResponse.json({ course: res.rows[0] });
}

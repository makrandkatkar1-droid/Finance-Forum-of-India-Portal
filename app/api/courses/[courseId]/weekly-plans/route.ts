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

  const { weekStartDate, topics, moduleId, sessionType, activityName } = await req.json();
  if (!weekStartDate || !topics) {
    return NextResponse.json({ error: "weekStartDate and topics are required." }, { status: 400 });
  }
  const type = sessionType === "activity" ? "activity" : "module";

  const countRes = await query("SELECT COUNT(*)::int AS n FROM weekly_plans WHERE course_id = $1", [courseId]);
  const weekNumber = countRes.rows[0].n + 1;

  const res = await query(
    `INSERT INTO weekly_plans (course_id, module_id, week_number, week_start_date, session_type, activity_name, topics, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, week_number, week_start_date, session_type, activity_name, topics, module_id`,
    [courseId, type === "module" ? (moduleId || null) : null, weekNumber, weekStartDate, type, type === "activity" ? (activityName || null) : null, topics, session.id]
  );

  await logAudit(session.id, session.name, "weekly_plans", res.rows[0].id, `Added week ${weekNumber} plan`);
  return NextResponse.json({ weeklyPlan: res.rows[0] }, { status: 201 });
}

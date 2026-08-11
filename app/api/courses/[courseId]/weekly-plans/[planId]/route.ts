import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ courseId: string; planId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId, planId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { weekStartDate, topics, moduleId, sessionType, activityName } = await req.json();
  const type = sessionType === "activity" ? "activity" : "module";

  const res = await query(
    `UPDATE weekly_plans SET
       week_start_date = COALESCE($1, week_start_date),
       topics = COALESCE($2, topics),
       session_type = $3,
       module_id = CASE WHEN $3 = 'module' THEN $4 ELSE NULL END,
       activity_name = CASE WHEN $3 = 'activity' THEN $5 ELSE NULL END,
       updated_at = now()
     WHERE id = $6 AND course_id = $7
     RETURNING id, week_number, week_start_date, session_type, activity_name, topics, module_id`,
    [weekStartDate ?? null, topics ?? null, type, moduleId || null, activityName || null, planId, courseId]
  );

  if (res.rows.length === 0) return NextResponse.json({ error: "Weekly plan entry not found." }, { status: 404 });

  await logAudit(session.id, session.name, "weekly_plans", planId, `Edited week ${res.rows[0].week_number} plan`);
  return NextResponse.json({ weeklyPlan: res.rows[0] });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ courseId: string; planId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId, planId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  await query("DELETE FROM weekly_plans WHERE id = $1 AND course_id = $2", [planId, courseId]);
  await logAudit(session.id, session.name, "weekly_plans", planId, "Deleted a weekly plan entry");
  return NextResponse.json({ ok: true });
}

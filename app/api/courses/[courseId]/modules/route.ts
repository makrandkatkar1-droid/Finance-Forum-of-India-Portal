import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canEditCourse } from "@/lib/authz";

const VALID_STATUS = ["not_started", "in_progress", "completed"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { courseId } = await params;

  if (!(await canEditCourse(session, courseId))) {
    return NextResponse.json({ error: "You do not have edit access to this course." }, { status: 403 });
  }

  const { moduleId, moduleName, status } = await req.json();
  if (!moduleId) return NextResponse.json({ error: "moduleId is required." }, { status: 400 });
  if (status && !VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const res = await query(
    `UPDATE modules SET
       module_name = COALESCE($1, module_name),
       status = COALESCE($2, status),
       completed_date = CASE
         WHEN $2 = 'completed' THEN CURRENT_DATE
         WHEN $2 IS NOT NULL THEN NULL
         ELSE completed_date
       END,
       updated_by = $3,
       updated_at = now()
     WHERE id = $4 AND course_id = $5
     RETURNING id, module_number, module_name, status, completed_date`,
    [moduleName ?? null, status ?? null, session.id, moduleId, courseId]
  );

  if (res.rows.length === 0) return NextResponse.json({ error: "Module not found." }, { status: 404 });

  await logAudit(session.id, session.name, "modules", moduleId,
    `Updated module ${res.rows[0].module_number} status to "${res.rows[0].status}"`);

  return NextResponse.json({ module: res.rows[0] });
}

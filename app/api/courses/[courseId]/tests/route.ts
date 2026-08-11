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

  const { testType, testDate } = await req.json();
  if (!testType || !testDate || !["internal", "surprise"].includes(testType)) {
    return NextResponse.json({ error: "Valid testType (internal/surprise) and testDate are required." }, { status: 400 });
  }

  const res = await query(
    `INSERT INTO tests (course_id, test_type, test_date, created_by) VALUES ($1,$2,$3,$4)
     RETURNING id, test_type, test_date`,
    [courseId, testType, testDate, session.id]
  );

  await logAudit(session.id, session.name, "tests", res.rows[0].id, `Scheduled a ${testType} test`);

  return NextResponse.json({ test: res.rows[0] }, { status: 201 });
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

  await query("DELETE FROM tests WHERE id = $1 AND course_id = $2", [id, courseId]);
  await logAudit(session.id, session.name, "tests", id, "Removed a scheduled test");

  return NextResponse.json({ ok: true });
}

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

  const { title, description, deadline } = await req.json();
  if (!title || !deadline) {
    return NextResponse.json({ error: "title and deadline are required." }, { status: 400 });
  }

  const res = await query(
    `INSERT INTO assignments (course_id, title, description, deadline, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, title, description, deadline`,
    [courseId, title, description || null, deadline, session.id]
  );

  await logAudit(session.id, session.name, "assignments", res.rows[0].id, `Posted assignment "${title}"`);

  return NextResponse.json({ assignment: res.rows[0] }, { status: 201 });
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

  await query("DELETE FROM assignments WHERE id = $1 AND course_id = $2", [id, courseId]);
  await logAudit(session.id, session.name, "assignments", id, "Removed assignment");

  return NextResponse.json({ ok: true });
}

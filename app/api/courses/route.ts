import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allowedBatchIds } from "@/lib/authz";
import { insertSubject, validateSubject } from "@/lib/subjects";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const batchId = req.nextUrl.searchParams.get("batchId");
  const allowed = await allowedBatchIds(session);
  if (batchId && allowed !== null && !allowed.includes(batchId)) {
    return NextResponse.json({ error: "You do not have access to this batch." }, { status: 403 });
  }

  const res = await query(
    `SELECT c.id, c.name, c.code, c.day_allocated, c.day_parity, c.total_hours, c.batch_id, c.results_published,
            c.semester_id, c.external_max_marks, c.faculty_id, u.name AS faculty_name
     FROM courses c JOIN users u ON u.id = c.faculty_id
     ${batchId ? "WHERE c.batch_id = $1" : ""}
     ORDER BY c.name`,
    batchId ? [batchId] : []
  );

  // Faculty only see the subjects they teach (in every semester).
  const courses = session.role === "faculty" ? res.rows.filter((c) => c.faculty_id === session.id) : res.rows;
  return NextResponse.json({ courses });
}

// Admin: add a subject to a semester, with its modules and internal pattern.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const body = await req.json();
  const problem = validateSubject({ ...body, modules: body.modules ?? [], components: body.components ?? [] });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const sem = await query("SELECT id, batch_id, name FROM semesters WHERE id = $1", [body.semesterId]);
  if (sem.rows.length === 0) return NextResponse.json({ error: "Please choose a semester." }, { status: 400 });
  const fac = await query("SELECT id FROM users WHERE id = $1 AND role = 'faculty'", [body.facultyId]);
  if (fac.rows.length === 0) return NextResponse.json({ error: "That faculty member was not found." }, { status: 400 });

  const course = await withTransaction((client) => insertSubject(client, {
    batchId: sem.rows[0].batch_id, semesterId: body.semesterId, name: body.name, code: body.code, facultyId: body.facultyId,
    dayAllocated: body.dayAllocated, dayParity: body.dayParity, totalHours: body.totalHours, externalMaxMarks: body.externalMaxMarks,
    modules: (body.modules ?? []).map((m: any) => ({ name: m.name ?? "" })),
    components: (body.components ?? []).map((c: any) => ({ name: c.name, maxMarks: Number(c.maxMarks) })),
  }, session.id));

  await logAudit(session.id, session.name, "courses", course.id, `Added subject ${course.name} (${course.code}) to ${sem.rows[0].name}`);
  return NextResponse.json({ course }, { status: 201 });
}

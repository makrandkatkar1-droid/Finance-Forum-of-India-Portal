import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allowedBatchIds } from "@/lib/authz";
import { insertSubject } from "@/lib/subjects";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const batchId = req.nextUrl.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });

  const allowed = await allowedBatchIds(session);
  if (allowed !== null && !allowed.includes(batchId)) return NextResponse.json({ error: "You do not have access to this batch." }, { status: 403 });

  const res = await query(
    `SELECT s.id, s.name, s.semester_number, s.is_current,
            (SELECT COUNT(*)::int FROM courses c WHERE c.semester_id = s.id) AS subject_count
     FROM semesters s WHERE s.batch_id = $1 ORDER BY s.semester_number`,
    [batchId]
  );
  return NextResponse.json({ semesters: res.rows });
}

// Add the next semester to a batch. Optionally start it with a copy of another
// semester's subjects (same names, faculty, timetable, modules and internal
// pattern — but no attendance, marks or progress), ready to be edited.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { batchId, name, copyFromSemesterId } = await req.json();
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });

  const result = await withTransaction(async (client) => {
    const next = await client.query("SELECT COALESCE(MAX(semester_number), 0) + 1 AS n FROM semesters WHERE batch_id = $1", [batchId]);
    const number = next.rows[0].n as number;
    const semName = typeof name === "string" && name.trim() ? name.trim() : `Semester ${number}`;
    const sem = await client.query(
      `INSERT INTO semesters (batch_id, name, semester_number, is_current)
       VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM semesters WHERE batch_id = $1))
       RETURNING id, name, semester_number, is_current`,
      [batchId, semName, number]
    );

    let copied = 0;
    if (copyFromSemesterId) {
      const src = await client.query(
        "SELECT * FROM courses WHERE semester_id = $1 AND batch_id = $2 ORDER BY name",
        [copyFromSemesterId, batchId]
      );
      for (const c of src.rows) {
        const [mods, comps] = await Promise.all([
          client.query("SELECT module_name FROM modules WHERE course_id = $1 ORDER BY module_number", [c.id]),
          client.query("SELECT component_name, max_marks FROM assessment_components WHERE course_id = $1 ORDER BY display_order", [c.id]),
        ]);
        await insertSubject(client, {
          batchId, semesterId: sem.rows[0].id, name: c.name, code: c.code, facultyId: c.faculty_id,
          dayAllocated: c.day_allocated, dayParity: c.day_parity, totalHours: c.total_hours, externalMaxMarks: c.external_max_marks,
          modules: mods.rows.map((m) => ({ name: m.module_name || "" })),
          components: comps.rows.map((x) => ({ name: x.component_name, maxMarks: x.max_marks })),
        }, session.id);
        copied++;
      }
    }
    return { semester: sem.rows[0], copied };
  });

  await logAudit(session.id, session.name, "semesters", result.semester.id,
    `Added ${result.semester.name}${result.copied ? ` with ${result.copied} subjects copied` : ""}`);
  return NextResponse.json(result, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Rename a semester, or make it the current one (students and faculty open the
// current semester by default).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ semesterId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { semesterId } = await params;
  const { name, isCurrent } = await req.json();

  const found = await query("SELECT id, batch_id, name FROM semesters WHERE id = $1", [semesterId]);
  if (found.rows.length === 0) return NextResponse.json({ error: "Semester not found." }, { status: 404 });
  const sem = found.rows[0];

  if (name !== undefined) {
    if (!String(name).trim()) return NextResponse.json({ error: "Semester name cannot be empty." }, { status: 400 });
    await query("UPDATE semesters SET name = $1 WHERE id = $2", [String(name).trim(), semesterId]);
    await logAudit(session.id, session.name, "semesters", semesterId, `Renamed ${sem.name} to "${String(name).trim()}"`);
  }
  if (isCurrent === true) {
    await withTransaction(async (client) => {
      await client.query("UPDATE semesters SET is_current = false WHERE batch_id = $1", [sem.batch_id]);
      await client.query("UPDATE semesters SET is_current = true WHERE id = $1", [semesterId]);
    });
    await logAudit(session.id, session.name, "semesters", semesterId, `Made ${String(name ?? sem.name).trim()} the current semester`);
  }

  const res = await query("SELECT id, name, semester_number, is_current FROM semesters WHERE id = $1", [semesterId]);
  return NextResponse.json({ semester: res.rows[0] });
}

// A semester can only be removed once it has no subjects left.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ semesterId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { semesterId } = await params;

  const found = await query(
    `SELECT s.id, s.batch_id, s.name, s.is_current,
            (SELECT COUNT(*)::int FROM courses c WHERE c.semester_id = s.id) AS subjects,
            (SELECT COUNT(*)::int FROM semesters x WHERE x.batch_id = s.batch_id) AS siblings
     FROM semesters s WHERE s.id = $1`,
    [semesterId]
  );
  if (found.rows.length === 0) return NextResponse.json({ error: "Semester not found." }, { status: 404 });
  const sem = found.rows[0];
  if (sem.subjects > 0) return NextResponse.json({ error: `${sem.name} still has ${sem.subjects} subject${sem.subjects > 1 ? "s" : ""}. Delete those first.` }, { status: 409 });
  if (sem.siblings <= 1) return NextResponse.json({ error: "A batch needs at least one semester." }, { status: 409 });

  await withTransaction(async (client) => {
    await client.query("DELETE FROM semesters WHERE id = $1", [semesterId]);
    if (sem.is_current) {
      await client.query(
        `UPDATE semesters SET is_current = true WHERE id = (
           SELECT id FROM semesters WHERE batch_id = $1 ORDER BY semester_number DESC LIMIT 1)`,
        [sem.batch_id]
      );
    }
  });
  await logAudit(session.id, session.name, "semesters", semesterId, `Deleted ${sem.name}`);
  return NextResponse.json({ ok: true });
}

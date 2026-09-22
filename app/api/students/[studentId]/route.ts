import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool, query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { studentId } = await params;
  const { name, username, password, feeCategory, batchId } = await req.json();

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name); }
  if (username !== undefined) { sets.push(`username = $${i++}`); values.push(username); }
  if (password) { sets.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }
  if (feeCategory !== undefined) { sets.push(`fee_category = $${i++}`); values.push(feeCategory); }
  if (batchId !== undefined) { sets.push(`batch_id = $${i++}`); values.push(batchId); }
  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  values.push(studentId);
  const res = await query(
    `UPDATE student_roster SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, label, name, username, seat_number, batch_id, fee_category`,
    values
  );
  if (res.rows.length === 0) return NextResponse.json({ error: "Student not found." }, { status: 404 });

  await logAudit(session.id, session.name, "student_roster", studentId, `Updated student record for ${res.rows[0].label}`);
  return NextResponse.json({ student: res.rows[0] });
}

// Permanently removes a student and every record tied to them: login,
// attendance (course lectures + guest events), marks, and fee payments.
// Runs in one transaction, so either everything is removed or nothing is.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { studentId } = await params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id, label, name FROM student_roster WHERE id = $1 FOR UPDATE", [studentId]);
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    const student = found.rows[0];

    // Delete child rows explicitly rather than relying on ON DELETE CASCADE,
    // because some tables (e.g. event_attendance) were created directly in
    // Supabase and may not have cascade rules.
    const childTables = ["event_attendance", "attendance_records", "student_scores", "summative_marks", "student_fee_payments"];
    for (const table of childTables) {
      const exists = await client.query("SELECT to_regclass($1) AS t", [`public.${table}`]);
      if (exists.rows[0].t) await client.query(`DELETE FROM ${table} WHERE student_roster_id = $1`, [studentId]);
    }
    await client.query("DELETE FROM student_roster WHERE id = $1", [studentId]);
    await client.query("COMMIT");

    const displayName = student.name?.trim() ? `${student.name} (${student.label})` : student.label;
    await logAudit(session.id, session.name, "student_roster", null, `Deleted student ${displayName} and all their records`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not delete student: ${message}` }, { status: 500 });
  } finally {
    client.release();
  }
}

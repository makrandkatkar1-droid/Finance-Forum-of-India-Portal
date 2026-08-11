import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
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

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const batchId = req.nextUrl.searchParams.get("batchId");

  const admin = await query("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1");
  // One row per faculty member. course_id is their first subject in the batch
  // (used to tag payout entries); faculty teaching several subjects appear once.
  const faculty = await query(
    `SELECT DISTINCT ON (u.name, u.id) u.id, u.name, u.username, u.pay_rate, c.id AS course_id, c.name AS course_name, c.batch_id FROM users u
     LEFT JOIN courses c ON c.faculty_id = u.id ${batchId ? "AND c.batch_id = $1" : ""}
     WHERE u.role = 'faculty' ${batchId ? "AND c.id IS NOT NULL" : ""}
     ORDER BY u.name, u.id, c.name`,
    batchId ? [batchId] : []
  );

  return NextResponse.json({
    admin: admin.rows[0] || null,
    faculty: faculty.rows,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { userId, name, username, password, payRate } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (name !== undefined) {
    if (!String(name).trim()) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    sets.push(`name = $${i++}`); values.push(String(name).trim());
  }
  if (username) {
    const clean = String(username).trim();
    if (/\s/.test(clean)) return NextResponse.json({ error: "Username cannot contain spaces." }, { status: 400 });
    const taken = await query("SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2", [clean, userId]);
    if (taken.rows.length) return NextResponse.json({ error: `The username "${clean}" is already in use.` }, { status: 409 });
    sets.push(`username = $${i++}`); values.push(clean);
  }
  if (password) { sets.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }
  if (payRate !== undefined) { sets.push(`pay_rate = $${i++}`); values.push(payRate); }
  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  values.push(userId);
  const res = await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, username, role, pay_rate`, values);
  if (res.rows.length === 0) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await logAudit(session.id, session.name, "users", userId, `Updated login credentials for ${res.rows[0].name}`);
  return NextResponse.json({ user: res.rows[0] });
}

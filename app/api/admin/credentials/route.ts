import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const admin = await query("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1");
  const faculty = await query(
    `SELECT u.id, u.name, u.username, u.pay_rate, c.name AS course_name FROM users u
     LEFT JOIN courses c ON c.faculty_id = u.id WHERE u.role = 'faculty' ORDER BY u.name`
  );

  return NextResponse.json({
    admin: admin.rows[0] || null,
    faculty: faculty.rows,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { userId, username, password, payRate } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (username) { sets.push(`username = $${i++}`); values.push(username); }
  if (password) { sets.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }
  if (payRate !== undefined) { sets.push(`pay_rate = $${i++}`); values.push(payRate); }
  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  values.push(userId);
  const res = await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, username, role, pay_rate`, values);
  if (res.rows.length === 0) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await logAudit(session.id, session.name, "users", userId, `Updated login credentials for ${res.rows[0].name}`);
  return NextResponse.json({ user: res.rows[0] });
}

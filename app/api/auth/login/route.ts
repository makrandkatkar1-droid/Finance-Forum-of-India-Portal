import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password, role } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  // Students now have individual accounts in student_roster, not the users table.
  if (role === "student") {
    const res = await query(
      "SELECT id, label, name, username, password_hash, batch_id FROM student_roster WHERE username = $1",
      [username]
    );
    const student = res.rows[0];
    if (!student || !student.password_hash) {
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }
    const valid = await bcrypt.compare(password, student.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }
    const displayName = student.name?.trim() ? student.name : student.label;
    await createSession({
      id: student.id, name: displayName, username: student.username, role: "student",
      studentId: student.id, batchId: student.batch_id,
    });
    await logAudit(null, displayName, "student_roster", student.id, "Logged in as student");
    return NextResponse.json({ ok: true, user: { name: displayName, role: "student", studentId: student.id, batchId: student.batch_id } });
  }

  const res = await query("SELECT id, name, username, password_hash, role FROM users WHERE username = $1", [username]);
  const user = res.rows[0];

  if (!user) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  let courseId: string | null = null;
  if (user.role === "faculty") {
    const courseRes = await query("SELECT id FROM courses WHERE faculty_id = $1", [user.id]);
    courseId = courseRes.rows[0]?.id ?? null;
  }

  await createSession({ id: user.id, name: user.name, username: user.username, role: user.role, courseId });
  await logAudit(user.id, user.name, "users", user.id, `Logged in as ${user.role}`);

  return NextResponse.json({ ok: true, user: { name: user.name, role: user.role, courseId } });
}

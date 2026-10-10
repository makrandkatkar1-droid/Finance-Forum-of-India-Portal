import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Admin: every faculty member, with the subjects they teach (all batches and semesters).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const res = await query(
    `SELECT u.id, u.name, u.username, u.pay_rate,
            COALESCE(json_agg(json_build_object(
              'id', c.id, 'name', c.name, 'batch_id', c.batch_id, 'batch_name', b.name,
              'semester_id', c.semester_id, 'semester_name', s.name
            ) ORDER BY b.created_at, s.semester_number, c.name) FILTER (WHERE c.id IS NOT NULL), '[]') AS subjects
     FROM users u
     LEFT JOIN courses c ON c.faculty_id = u.id
     LEFT JOIN batches b ON b.id = c.batch_id
     LEFT JOIN semesters s ON s.id = c.semester_id
     WHERE u.role = 'faculty'
     GROUP BY u.id ORDER BY u.name`
  );
  return NextResponse.json({ faculty: res.rows });
}

// Admin: add a faculty member (their own login). Subjects are assigned from
// the Semesters & subjects screen.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { name, username, password, payRate } = await req.json();
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  if (!cleanName) return NextResponse.json({ error: "Please enter the faculty member's name." }, { status: 400 });
  if (!cleanUsername) return NextResponse.json({ error: "Please enter a username." }, { status: 400 });
  if (/\s/.test(cleanUsername)) return NextResponse.json({ error: "Username cannot contain spaces." }, { status: 400 });
  if (!password || String(password).length < 4) return NextResponse.json({ error: "Password must be at least 4 characters." }, { status: 400 });
  const rate = payRate === undefined || payRate === "" || payRate === null ? 800 : Number(payRate);
  if (isNaN(rate) || rate < 0) return NextResponse.json({ error: "Pay rate must be a positive number." }, { status: 400 });

  const taken = await query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [cleanUsername]);
  if (taken.rows.length) return NextResponse.json({ error: `The username "${cleanUsername}" is already in use. Please choose another.` }, { status: 409 });

  const hash = await bcrypt.hash(String(password), 10);
  const res = await query(
    `INSERT INTO users (name, username, password_hash, role, pay_rate) VALUES ($1, $2, $3, 'faculty', $4)
     RETURNING id, name, username, pay_rate`,
    [cleanName, cleanUsername, hash, rate]
  );
  await logAudit(session.id, session.name, "users", res.rows[0].id, `Added faculty member ${cleanName}`);
  return NextResponse.json({ faculty: { ...res.rows[0], subjects: [] } }, { status: 201 });
}

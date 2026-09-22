import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");

  const res = batchId
    ? await query("SELECT id, label, name, seat_number, username, batch_id, fee_category FROM student_roster WHERE batch_id = $1 ORDER BY seat_number", [batchId])
    : await query("SELECT id, label, name, seat_number, username, batch_id, fee_category FROM student_roster ORDER BY seat_number");

  return NextResponse.json({ students: res.rows });
}

// Add a new student to a batch. Seat numbers are unique across the portal,
// so the new student gets the next free number (e.g. "Student 51").
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { batchId, name, username, password, feeCategory } = await req.json();
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });
  if (!cleanName) return NextResponse.json({ error: "Please enter the student's name." }, { status: 400 });
  if (!cleanUsername) return NextResponse.json({ error: "Please enter a username." }, { status: 400 });
  if (/\s/.test(cleanUsername)) return NextResponse.json({ error: "Username cannot contain spaces." }, { status: 400 });
  if (!password || String(password).length < 4) return NextResponse.json({ error: "Password must be at least 4 characters." }, { status: 400 });

  const taken = await query("SELECT 1 FROM student_roster WHERE lower(username) = lower($1)", [cleanUsername]);
  if (taken.rows.length) return NextResponse.json({ error: `The username "${cleanUsername}" is already in use. Please choose another.` }, { status: 409 });

  const hash = await bcrypt.hash(String(password), 10);
  // Retry once in case two admins add a student at the same moment and grab the same seat number.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await query(
        `INSERT INTO student_roster (label, name, seat_number, username, password_hash, batch_id, fee_category)
         SELECT 'Student ' || lpad(next_seat::text, 2, '0'), $1, next_seat, $2, $3, $4, $5
         FROM (SELECT COALESCE(MAX(seat_number), 0) + 1 AS next_seat FROM student_roster) s
         RETURNING id, label, name, seat_number, username, batch_id, fee_category`,
        [cleanName, cleanUsername, hash, batchId, feeCategory === "Reserved" ? "Reserved" : "General"]
      );
      const student = res.rows[0];
      await logAudit(session.id, session.name, "student_roster", student.id, `Added student ${student.name} (${student.label})`);
      return NextResponse.json({ student }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "23505" && attempt === 0) continue; // unique clash, try the next seat
      if (code === "23505") return NextResponse.json({ error: "That username or seat is already taken. Please try again." }, { status: 409 });
      throw err;
    }
  }
  return NextResponse.json({ error: "Could not add the student. Please try again." }, { status: 500 });
}

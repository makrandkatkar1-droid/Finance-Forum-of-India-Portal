import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const facultyId = req.nextUrl.searchParams.get("facultyId");
  if (!facultyId) return NextResponse.json({ error: "facultyId query param required." }, { status: 400 });

  const res = await query(
    `SELECT fs.id, fs.session_date, fs.topic, fs.hours, fs.rate, fs.paid, fs.course_id, c.name AS course_name, c.batch_id
     FROM faculty_sessions fs LEFT JOIN courses c ON c.id = fs.course_id
     WHERE fs.faculty_id = $1 ORDER BY fs.session_date DESC`,
    [facultyId]
  );
  return NextResponse.json({ sessions: res.rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { facultyId, courseId, date, topic, hours, rate } = await req.json();
  if (!facultyId || !date || hours === undefined) {
    return NextResponse.json({ error: "facultyId, date, and hours are required." }, { status: 400 });
  }

  const res = await query(
    `INSERT INTO faculty_sessions (faculty_id, course_id, session_date, topic, hours, rate, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, session_date, topic, hours, rate, paid`,
    [facultyId, courseId || null, date, topic || null, hours, rate || 0, session.id]
  );

  await logAudit(session.id, session.name, "faculty_sessions", res.rows[0].id, `Logged ${hours} payout hours`);
  return NextResponse.json({ session: res.rows[0] }, { status: 201 });
}

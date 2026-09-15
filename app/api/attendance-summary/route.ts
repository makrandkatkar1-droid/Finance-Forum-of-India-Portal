import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const batchId = req.nextUrl.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId query param required." }, { status: 400 });

  const courseSessionsRes = await query(
    `SELECT COUNT(asess.id)::int AS n
     FROM courses c LEFT JOIN attendance_sessions asess ON asess.course_id = c.id
     WHERE c.batch_id = $1`,
    [batchId]
  );
  const totalCourseSessions = courseSessionsRes.rows[0]?.n || 0;

  const eventsRes = await query(`SELECT COUNT(*)::int AS n FROM calendar_events WHERE batch_id = $1`, [batchId]);
  const totalEvents = eventsRes.rows[0]?.n || 0;

  const totalDenominator = totalCourseSessions + totalEvents;

  const coursePresentRes = await query(
    `SELECT ar.student_roster_id, COUNT(*)::int AS present_count
     FROM attendance_records ar
     JOIN attendance_sessions asess ON asess.id = ar.session_id
     JOIN courses c ON c.id = asess.course_id
     WHERE c.batch_id = $1 AND ar.present = true
     GROUP BY ar.student_roster_id`,
    [batchId]
  );

  const eventPresentRes = await query(
    `SELECT ea.student_roster_id, COUNT(*)::int AS present_count
     FROM event_attendance ea
     JOIN calendar_events ce ON ce.id = ea.event_id
     WHERE ce.batch_id = $1 AND ea.present = true
     GROUP BY ea.student_roster_id`,
    [batchId]
  );

  const coursePresent: Record<string, number> = {};
  for (const row of coursePresentRes.rows) coursePresent[row.student_roster_id] = row.present_count;
  const eventPresent: Record<string, number> = {};
  for (const row of eventPresentRes.rows) eventPresent[row.student_roster_id] = row.present_count;

  const studentsRes = await query(`SELECT id, label, name FROM student_roster WHERE batch_id = $1 ORDER BY seat_number`, [batchId]);

  const students = studentsRes.rows.map((s) => {
    const present = (coursePresent[s.id] || 0) + (eventPresent[s.id] || 0);
    const pct = totalDenominator ? Math.round((present / totalDenominator) * 100) : null;
    return {
      id: s.id,
      name: s.name?.trim() ? s.name : s.label,
      coursePresent: coursePresent[s.id] || 0,
      eventPresent: eventPresent[s.id] || 0,
      totalPresent: present,
      pct,
    };
  });

  const withData = students.filter((s) => s.pct !== null);
  const overallAvg = withData.length ? Math.round(withData.reduce((sum, s) => sum + (s.pct || 0), 0) / withData.length) : null;

  return NextResponse.json({
    totalCourseSessions,
    totalEvents,
    totalDenominator,
    students,
    overallAvg,
  });
}

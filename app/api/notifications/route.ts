import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const courseFilter = session.role === "faculty" ? "WHERE c.faculty_id = $1" : "";
  const args = session.role === "faculty" ? [session.id] : [];

  const assignments = await query(
    `SELECT a.id, a.title, a.deadline, c.name AS course_name FROM assignments a
     JOIN courses c ON c.id = a.course_id
     ${courseFilter}
     ${courseFilter ? "AND" : "WHERE"} a.deadline <= now() + interval '7 days'
     ORDER BY a.deadline`,
    args
  );

  const tests = await query(
    `SELECT t.id, t.test_type, t.test_date, c.name AS course_name FROM tests t
     JOIN courses c ON c.id = t.course_id
     ${courseFilter}
     ${courseFilter ? "AND" : "WHERE"} t.test_date <= CURRENT_DATE + interval '7 days'
     ORDER BY t.test_date`,
    args
  );

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const events = await query(
    `SELECT id, event_date, title, note FROM calendar_events WHERE event_date <= CURRENT_DATE + interval '7 days'`
  );

  const items = [
    ...assignments.rows.map((a) => ({
      id: `a_${a.id}`, type: "assignment", label: a.title, courseName: a.course_name,
      date: a.deadline, overdue: new Date(a.deadline) < today,
    })),
    ...tests.rows.map((t) => ({
      id: `t_${t.id}`, type: "test", label: t.test_type === "surprise" ? "Surprise test" : "Internal test",
      courseName: t.course_name, date: t.test_date, overdue: new Date(t.test_date) < today,
    })),
    ...events.rows.map((e) => ({
      id: `e_${e.id}`, type: "event", label: e.title, courseName: e.note || "Batch-wide",
      date: e.event_date, overdue: new Date(e.event_date) < today,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return NextResponse.json({ items });
}

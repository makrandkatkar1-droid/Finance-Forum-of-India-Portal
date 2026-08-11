import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const [assignments, tests, modules, plans, custom] = await Promise.all([
    query(`SELECT a.deadline AS date, a.title AS label, c.name AS course_name FROM assignments a JOIN courses c ON c.id = a.course_id`),
    query(`SELECT t.test_date AS date, t.test_type, c.name AS course_name FROM tests t JOIN courses c ON c.id = t.course_id`),
    query(`SELECT m.completed_date AS date, m.module_number, c.name AS course_name FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.completed_date IS NOT NULL`),
    query(`SELECT wp.week_start_date AS date, wp.session_type, wp.activity_name, wp.topics, mo.module_number, c.name AS course_name
           FROM weekly_plans wp JOIN courses c ON c.id = wp.course_id LEFT JOIN modules mo ON mo.id = wp.module_id`),
    query(`SELECT id, event_date AS date, title, note, batch_id FROM calendar_events`),
  ]);

  const events = [
    ...assignments.rows.map((a) => ({ type: "assignment", date: a.date, label: a.label, courseName: a.course_name })),
    ...tests.rows.map((t) => ({ type: "test", date: t.date, label: t.test_type === "surprise" ? "Surprise test" : "Internal test", courseName: t.course_name })),
    ...modules.rows.map((m) => ({ type: "module", date: m.date, label: `Module ${m.module_number} completed`, courseName: m.course_name })),
    ...plans.rows.map((p) => ({
      type: "session", date: p.date,
      label: `${p.course_name}: ${p.session_type === "activity" ? (p.activity_name || "Activity") : (p.module_number ? `Module ${p.module_number}` : "Session")}`,
      courseName: p.topics || "",
    })),
    ...custom.rows.map((e) => ({ type: "custom", date: e.date, label: e.title, courseName: e.note || "Batch-wide event", id: e.id, batchId: e.batch_id })),
  ];

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { date, title, note, batchId } = await req.json();
  if (!date || !title) return NextResponse.json({ error: "date and title are required." }, { status: 400 });

  const res = await query(
    `INSERT INTO calendar_events (batch_id, event_date, title, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, event_date, title, note`,
    [batchId || null, date, title, note || null, session.id]
  );

  await logAudit(session.id, session.name, "calendar_events", res.rows[0].id, `Added calendar event "${title}"`);
  return NextResponse.json({ event: res.rows[0] }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required." }, { status: 400 });

  await query("DELETE FROM calendar_events WHERE id = $1", [id]);
  await logAudit(session.id, session.name, "calendar_events", id, "Removed a calendar event");
  return NextResponse.json({ ok: true });
}

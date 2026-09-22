import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// MIS report data: attendance + course progress for one batch,
// for the last 7 days, last 30 days, or overall (till date),
// either across all subjects or for one subject.
// The PDF itself is drawn in the browser (lib/misReport.ts).
// ─────────────────────────────────────────────────────────────

type Period = "week" | "month" | "overall";

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / 86400000);
}
function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -offset);
}
function fmt(ymd: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}
function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}
const inRange = (date: string, start: string | null, end: string) => (!start || date >= start) && date <= end;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const batchId = req.nextUrl.searchParams.get("batchId");
  const period = (req.nextUrl.searchParams.get("period") || "overall") as Period;
  const courseParam = req.nextUrl.searchParams.get("courseId");
  const courseId = courseParam && courseParam !== "all" ? courseParam : null;
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });
  if (!["week", "month", "overall"].includes(period)) return NextResponse.json({ error: "Invalid period." }, { status: 400 });

  const batchRes = await query("SELECT id, name FROM batches WHERE id = $1", [batchId]);
  if (batchRes.rows.length === 0) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

  const coursesRes = await query(
    `SELECT c.id, c.name, u.name AS faculty_name FROM courses c JOIN users u ON u.id = c.faculty_id
     WHERE c.batch_id = $1 ${courseId ? "AND c.id = $2" : ""} ORDER BY c.name`,
    courseId ? [batchId, courseId] : [batchId]
  );
  const courses = coursesRes.rows;
  if (courseId && courses.length === 0) return NextResponse.json({ error: "Subject not found in this batch." }, { status: 404 });
  const courseIds = courses.map((c) => c.id);

  const studentsRes = await query(
    "SELECT id, label, name FROM student_roster WHERE batch_id = $1 ORDER BY seat_number",
    [batchId]
  );
  const students = studentsRes.rows.map((s) => ({ id: s.id as string, name: (s.name?.trim() ? s.name : s.label) as string }));
  const studentIds = new Set(students.map((s) => s.id));
  const studentCount = students.length;

  // All sessions + present marks for the subjects in scope (any date — we slice by period in code).
  const sessionsRes = courseIds.length
    ? await query(
        `SELECT id, course_id, to_char(session_date, 'YYYY-MM-DD') AS d FROM attendance_sessions
         WHERE course_id = ANY($1::uuid[]) ORDER BY session_date`,
        [courseIds]
      )
    : { rows: [] as any[] };
  const allSessions = sessionsRes.rows as { id: string; course_id: string; d: string }[];

  const presentRes = allSessions.length
    ? await query(
        `SELECT session_id, student_roster_id FROM attendance_records
         WHERE present = true AND session_id = ANY($1::uuid[])`,
        [allSessions.map((s) => s.id)]
      )
    : { rows: [] as any[] };
  const presentBySession: Record<string, Set<string>> = {};
  for (const r of presentRes.rows) {
    if (!studentIds.has(r.student_roster_id)) continue; // ignore marks for students no longer in this batch
    (presentBySession[r.session_id] ||= new Set()).add(r.student_roster_id);
  }

  const modulesRes = courseIds.length
    ? await query(
        `SELECT course_id, module_number, module_name, status, to_char(completed_date, 'YYYY-MM-DD') AS completed
         FROM modules WHERE course_id = ANY($1::uuid[]) ORDER BY module_number`,
        [courseIds]
      )
    : { rows: [] as any[] };

  // ── Period window ──
  const end = todayIST();
  const firstSession = allSessions[0]?.d || null;
  let start: string | null;
  let prevStart: string | null = null;
  let prevEnd: string | null = null;
  if (period === "week") { start = addDays(end, -6); prevStart = addDays(start, -7); prevEnd = addDays(start, -1); }
  else if (period === "month") { start = addDays(end, -29); prevStart = addDays(start, -30); prevEnd = addDays(start, -1); }
  else { start = null; }
  const effectiveStart = start || firstSession || end;

  const periodLabel = period === "week" ? "Last 7 days" : period === "month" ? "Last 30 days" : "Overall (till date)";

  // ── Per-subject attendance ──
  const sessionsIn = (from: string | null, to: string) => allSessions.filter((s) => inRange(s.d, from, to));
  const periodSessions = sessionsIn(start, end);
  const prevSessions = prevStart && prevEnd ? sessionsIn(prevStart, prevEnd) : [];

  const tally = (list: typeof allSessions) => {
    let present = 0;
    for (const s of list) present += presentBySession[s.id]?.size || 0;
    const possible = list.length * studentCount;
    return { sessions: list.length, present, possible, pct: pct(present, possible) };
  };

  const subjects = courses.map((c) => {
    const mine = periodSessions.filter((s) => s.course_id === c.id);
    const minePrev = prevSessions.filter((s) => s.course_id === c.id);
    const t = tally(mine);
    const tp = tally(minePrev);
    const mods = modulesRes.rows.filter((m) => m.course_id === c.id);
    const completed = mods.filter((m) => m.status === "completed").length;
    const inProgress = mods.filter((m) => m.status === "in_progress").length;
    const completedInPeriod = mods.filter((m) => m.status === "completed" && m.completed && inRange(m.completed, start, end)).length;
    return {
      id: c.id as string,
      name: c.name as string,
      faculty: c.faculty_name as string,
      ...t,
      prevPct: prevStart ? tp.pct : null,
      modulesTotal: mods.length,
      completed,
      inProgress,
      notStarted: mods.length - completed - inProgress,
      completedInPeriod,
      progressPct: mods.length ? Math.round((completed / mods.length) * 100) : 0,
      modules: mods.map((m) => ({ number: m.module_number as number, name: (m.module_name || "") as string, status: m.status as string, completed: m.completed as string | null })),
      sessionsList: mine.map((s) => ({ date: s.d, present: presentBySession[s.id]?.size || 0, pct: pct(presentBySession[s.id]?.size || 0, studentCount) })),
    };
  });

  const overallNow = tally(periodSessions);
  const overallPrev = tally(prevSessions);

  // ── Guest lectures / events (batch-wide, only in the all-subjects report) ──
  let events = null as null | { count: number; present: number; possible: number; pct: number | null };
  if (!courseId) {
    const evRes = await query(
      `SELECT id, to_char(event_date, 'YYYY-MM-DD') AS d FROM calendar_events WHERE batch_id = $1`,
      [batchId]
    );
    const evInRange = evRes.rows.filter((e) => inRange(e.d, start, end) && e.d <= end);
    let evPresent = 0;
    const eaExists = await query("SELECT to_regclass('public.event_attendance') AS t");
    if (evInRange.length && eaExists.rows[0].t) {
      const eaRes = await query(
        `SELECT student_roster_id FROM event_attendance WHERE present = true AND event_id = ANY($1::uuid[])`,
        [evInRange.map((e) => e.id)]
      );
      evPresent = eaRes.rows.filter((r) => studentIds.has(r.student_roster_id)).length;
    }
    events = { count: evInRange.length, present: evPresent, possible: evInRange.length * studentCount, pct: pct(evPresent, evInRange.length * studentCount) };
  }

  // ── Trend buckets ──
  type Bucket = { key: string; label: string; from: string; to: string };
  const buckets: Bucket[] = [];
  const span = daysBetween(effectiveStart, end);
  if (period === "week") {
    for (let i = 0; i <= 6; i++) {
      const d = addDays(start!, i);
      buckets.push({ key: d, label: fmt(d, { weekday: "short", day: "2-digit" }), from: d, to: d });
    }
  } else if (period === "month" || span <= 63) {
    let w = mondayOf(effectiveStart);
    while (w <= end) {
      const to = addDays(w, 6);
      buckets.push({ key: w, label: fmt(w, { day: "2-digit", month: "short" }), from: w, to });
      w = addDays(w, 7);
    }
  } else {
    let y = Number(effectiveStart.slice(0, 4));
    let m = Number(effectiveStart.slice(5, 7));
    while (`${y}-${String(m).padStart(2, "0")}-01` <= end) {
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      buckets.push({ key: from, label: fmt(from, { month: "short", year: "numeric" }), from, to: addDays(next, -1) });
      m++;
      if (m === 13) { m = 1; y++; }
    }
  }
  const trendGranularity = period === "week" ? "day" : period === "month" || span <= 63 ? "week" : "month";
  const trend = buckets.map((b) => {
    const t = tally(periodSessions.filter((s) => s.d >= b.from && s.d <= b.to));
    return { label: b.label, from: b.from, pct: t.pct, sessions: t.sessions };
  });

  // ── Student-wise attendance across the subjects in scope ──
  const totalSessions = periodSessions.length;
  const studentRows = students.map((s) => {
    let attended = 0;
    for (const sess of periodSessions) if (presentBySession[sess.id]?.has(s.id)) attended++;
    return { name: s.name, attended, possible: totalSessions, pct: pct(attended, totalSessions) };
  });
  const bands = { below50: 0, b50to74: 0, b75to89: 0, above90: 0 };
  for (const s of studentRows) {
    if (s.pct === null) continue;
    if (s.pct < 50) bands.below50++;
    else if (s.pct < 75) bands.b50to74++;
    else if (s.pct < 90) bands.b75to89++;
    else bands.above90++;
  }

  const modulesTotal = subjects.reduce((a, s) => a + s.modulesTotal, 0);
  const modulesCompleted = subjects.reduce((a, s) => a + s.completed, 0);

  return NextResponse.json({
    batch: batchRes.rows[0],
    period,
    periodLabel,
    startDate: start || firstSession,
    endDate: end,
    generatedAt: new Date().toISOString(),
    scope: courseId ? { courseId, courseName: courses[0].name, faculty: courses[0].faculty_name } : null,
    studentCount,
    overall: { ...overallNow, prevPct: prevStart ? overallPrev.pct : null, prevSessions: overallPrev.sessions },
    events,
    subjects,
    trend,
    trendGranularity,
    students: studentRows,
    bands,
    progress: {
      modulesTotal,
      modulesCompleted,
      modulesInProgress: subjects.reduce((a, s) => a + s.inProgress, 0),
      completedInPeriod: subjects.reduce((a, s) => a + s.completedInPeriod, 0),
      pct: modulesTotal ? Math.round((modulesCompleted / modulesTotal) * 100) : 0,
    },
  });
}

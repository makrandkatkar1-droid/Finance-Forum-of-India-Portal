// ─────────────────────────────────────────────────────────────
// Builds the MIS report PDF in the browser from /api/reports/mis data.
// Charts are drawn directly with jsPDF shapes (no screenshots), so
// they stay sharp at any zoom and print cleanly.
// ─────────────────────────────────────────────────────────────
import type { jsPDF as JsPDFType } from "jspdf";

export type MisSubject = {
  id: string; name: string; faculty: string;
  sessions: number; present: number; possible: number; pct: number | null; prevPct: number | null;
  modulesTotal: number; completed: number; inProgress: number; notStarted: number; completedInPeriod: number; progressPct: number;
  modules: { number: number; name: string; status: string; completed: string | null }[];
  sessionsList: { date: string; present: number; pct: number | null }[];
};
export type MisData = {
  batch: { id: string; name: string };
  period: "week" | "month" | "overall";
  periodLabel: string;
  startDate: string | null;
  endDate: string;
  generatedAt: string;
  scope: { courseId: string; courseName: string; faculty: string } | null;
  studentCount: number;
  overall: { sessions: number; present: number; possible: number; pct: number | null; prevPct: number | null; prevSessions: number };
  events: { count: number; present: number; possible: number; pct: number | null } | null;
  subjects: MisSubject[];
  trend: { label: string; from: string; pct: number | null; sessions: number }[];
  trendGranularity: "day" | "week" | "month";
  students: { name: string; attended: number; possible: number; pct: number | null }[];
  bands: { below50: number; b50to74: number; b75to89: number; above90: number };
  progress: { modulesTotal: number; modulesCompleted: number; modulesInProgress: number; completedInPeriod: number; pct: number };
};

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  navy: [11, 29, 46], green: [123, 186, 39], greenDark: [92, 148, 32], greenLight: [234, 245, 218],
  orange: [197, 118, 31], orangeLight: [251, 237, 219], red: [194, 59, 59], redLight: [252, 235, 235],
  text: [30, 36, 42], muted: [107, 106, 99], faint: [155, 154, 146], border: [228, 225, 216], bg: [245, 246, 241],
  grey: [205, 203, 196], white: [255, 255, 255],
};
const TARGET = 75;

const PAGE_W = 210, PAGE_H = 297, M = 16, CONTENT_W = PAGE_W - M * 2;

function fmtDate(ymd: string | null, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!ymd) return "-";
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}
const p1 = (v: number | null) => (v === null ? "-" : `${Math.round(v * 10) / 10}%`);
const round = (v: number) => Math.round(v);
function colourFor(v: number | null): RGB { if (v === null) return C.grey; return v >= TARGET ? C.green : v >= 50 ? C.orange : C.red; }
function plural(n: number, word: string, pluralWord = `${word}s`) { return `${n} ${n === 1 ? word : pluralWord}`; }
function listNames(names: string[], max = 4) {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "";
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
function change(now: number | null, prev: number | null, prevLabel: string) {
  if (now === null || prev === null) return "";
  const diff = Math.round((now - prev) * 10) / 10;
  if (Math.abs(diff) < 1) return ` That is about the same as the ${prevLabel} (${p1(prev)}).`;
  return ` That is ${diff > 0 ? "up" : "down"} ${Math.abs(diff)} percentage points from the ${prevLabel} (${p1(prev)}).`;
}

// ── Explanations (plain English, generated from the numbers) ──
function explainSubjectAttendance(d: MisData, prevLabel: string) {
  const withData = d.subjects.filter((s) => s.pct !== null);
  if (withData.length === 0) return "No lecture attendance was recorded in this period, so there is nothing to compare yet. Once faculty mark attendance in the Attendance tab, this chart fills in automatically.";
  const sorted = [...withData].sort((a, b) => (b.pct! - a.pct!));
  const below = sorted.filter((s) => s.pct! < TARGET);
  const noSessions = d.subjects.filter((s) => s.pct === null).map((s) => s.name);
  let t = `Each bar shows the share of seats filled across all lectures of that subject. ${plural(d.overall.sessions, "lecture session")} were held across ${plural(withData.length, "subject")}, with an average attendance of ${p1(d.overall.pct)}.${change(d.overall.pct, d.overall.prevPct, prevLabel)}`;
  if (sorted.length > 1) t += ` Attendance was highest in ${sorted[0].name} (${p1(sorted[0].pct)}) and lowest in ${sorted[sorted.length - 1].name} (${p1(sorted[sorted.length - 1].pct)}).`;
  t += below.length
    ? ` ${below.length === 1 ? "One subject is" : `${below.length} subjects are`} below the ${TARGET}% target: ${listNames(below.map((s) => s.name))}.`
    : ` Every subject with lectures in this period met the ${TARGET}% target.`;
  if (noSessions.length) t += ` No lectures were recorded for ${listNames(noSessions)} in this period.`;
  return t;
}
function explainSessions(s: MisSubject) {
  const list = s.sessionsList.filter((x) => x.pct !== null);
  if (list.length === 0) return "No lecture sessions were recorded for this subject in this period.";
  const hi = list.reduce((a, b) => (b.pct! > a.pct! ? b : a));
  const lo = list.reduce((a, b) => (b.pct! < a.pct! ? b : a));
  const below = list.filter((x) => x.pct! < TARGET).length;
  let t = `Each bar is one lecture session and shows the share of the batch that attended it. ${plural(list.length, "session")} were held, averaging ${p1(s.pct)}.`;
  if (list.length > 1) t += ` The best-attended session was on ${fmtDate(hi.date, { day: "2-digit", month: "short" })} (${p1(hi.pct)}); the lowest was on ${fmtDate(lo.date, { day: "2-digit", month: "short" })} (${p1(lo.pct)}).`;
  t += below ? ` ${below} of ${list.length} sessions fell below the ${TARGET}% target.` : ` Every session met the ${TARGET}% target.`;
  return t;
}
function explainTrend(d: MisData) {
  const unit = d.trendGranularity;
  const pts = d.trend.filter((p) => p.pct !== null);
  if (pts.length === 0) return "There are no attendance records in this period, so no trend can be drawn yet.";
  if (pts.length === 1) return `Attendance was recorded in only one ${unit} (${pts[0].label}), at ${p1(pts[0].pct)}. A trend becomes visible once more ${unit}s have data.`;
  const hi = pts.reduce((a, b) => (b.pct! > a.pct! ? b : a));
  const lo = pts.reduce((a, b) => (b.pct! < a.pct! ? b : a));
  const first = pts[0], last = pts[pts.length - 1];
  const diff = last.pct! - first.pct!;
  const direction = Math.abs(diff) < 3 ? "broadly steady" : diff > 0 ? "improving" : "declining";
  const unitWord = unit === "week" ? "week starting" : unit;
  return `The line tracks average attendance ${unit === "day" ? "day by day" : unit === "week" ? "week by week" : "month by month"}; gaps mean no lectures were held. It peaked in the ${unitWord} ${hi.label} (${p1(hi.pct)}) and dipped lowest in the ${unitWord} ${lo.label} (${p1(lo.pct)}). Comparing the first ${unit} with data (${p1(first.pct)}) to the latest (${p1(last.pct)}), attendance is ${direction}${direction === "broadly steady" ? "" : ` by ${Math.abs(round(diff))} percentage points`}.`;
}
function explainBands(d: MisData) {
  const b = d.bands;
  const counted = b.below50 + b.b50to74 + b.b75to89 + b.above90;
  if (counted === 0) return "Student-wise attendance appears here once lectures are recorded in this period.";
  const need = b.below50 + b.b50to74;
  return `This groups all ${plural(counted, "student")} by the share of lectures they attended in this period. ${b.above90} attended 90% or more, ${b.b75to89} attended 75-89%, ${b.b50to74} attended 50-74%, and ${b.below50} attended under 50%. ${need ? `The ${plural(need, "student")} below ${TARGET}% are listed in the follow-up table below.` : `No student is below the ${TARGET}% target.`}`;
}
function explainProgress(d: MisData) {
  const p = d.progress;
  if (p.modulesTotal === 0) return "No modules have been set up for the subjects in this report yet.";
  const periodNote = d.period === "overall" ? "" : ` ${plural(p.completedInPeriod, "module")} ${p.completedInPeriod === 1 ? "was" : "were"} completed during this period.`;
  if (d.scope) {
    const s = d.subjects[0];
    const current = s.modules.find((m) => m.status === "in_progress");
    return `The bar shows where ${s.name} stands in its syllabus today. ${s.completed} of ${s.modulesTotal} modules (${s.progressPct}%) are completed, ${s.inProgress} ${s.inProgress === 1 ? "is" : "are"} in progress and ${s.notStarted} ${s.notStarted === 1 ? "has" : "have"} not started.${periodNote}${current ? ` Module ${current.number}${current.name ? ` (${current.name})` : ""} is currently being taught.` : ""}`;
  }
  const sorted = [...d.subjects].filter((s) => s.modulesTotal > 0).sort((a, b) => b.progressPct - a.progressPct);
  let t = `Each bar shows how far a subject has moved through its syllabus as of today: green is completed, amber is in progress, grey is not started. Across the batch, ${p.modulesCompleted} of ${p.modulesTotal} modules (${p.pct}%) are completed and ${p.modulesInProgress} ${p.modulesInProgress === 1 ? "is" : "are"} in progress.${periodNote}`;
  if (sorted.length > 1) {
    t += ` ${sorted[0].name} is furthest ahead at ${sorted[0].progressPct}%, while ${sorted[sorted.length - 1].name} is furthest behind at ${sorted[sorted.length - 1].progressPct}%.`;
  }
  const notStarted = sorted.filter((s) => s.completed === 0 && s.inProgress === 0).map((s) => s.name);
  if (notStarted.length) t += ` ${listNames(notStarted)} ${notStarted.length === 1 ? "has" : "have"} not started any module yet.`;
  return t;
}

// ── Main builder ──
export async function buildMisReportPdf(d: MisData): Promise<{ doc: JsPDFType; filename: string }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = M;

  const prevLabel = d.period === "week" ? "previous 7 days" : d.period === "month" ? "previous 30 days" : "";
  const scopeLabel = d.scope ? d.scope.courseName : "All subjects";
  const rangeLabel = d.startDate ? `${fmtDate(d.startDate)} to ${fmtDate(d.endDate)}` : `Till ${fmtDate(d.endDate)}`;

  // ── primitives ──
  const setFill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const setText = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" = "normal", colour: RGB = C.text) => { doc.setFont("helvetica", style); doc.setFontSize(size); setText(colour); };

  const runningHeader = () => {
    font(8, "bold", C.muted);
    doc.text("FINANCE FORUM OF INDIA  |  MIS REPORT", M, 10);
    font(8, "normal", C.muted);
    doc.text(`${d.batch.name}  |  ${scopeLabel}  |  ${d.periodLabel}`, PAGE_W - M, 10, { align: "right" });
    setDraw(C.border); doc.setLineWidth(0.3); doc.line(M, 12.5, PAGE_W - M, 12.5);
  };
  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  const newPage = () => { doc.addPage(); runningHeader(); y = 20; };
  const ensure = (h: number) => { if (y + h > PAGE_H - 18) newPage(); };

  const paragraph = (text: string, size = 9.5, colour: RGB = C.text, gapAfter = 4) => {
    font(size, "normal", colour);
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    const lh = size * 0.42;
    for (const line of lines) { ensure(lh); doc.text(line, M, y + lh * 0.8); y += lh; }
    y += gapAfter;
  };
  const sectionTitle = (num: string, text: string) => {
    ensure(85);
    y += 2;
    setFill(C.green); doc.rect(M, y, 1.4, 7, "F");
    font(13, "bold", C.navy); doc.text(`${num}  ${text}`, M + 4, y + 5.3);
    y += 12;
  };
  // Keeps a title on the same page as the chart/table that follows it.
  const chartTitle = (text: string, sub?: string, keepWith = 70) => {
    ensure(keepWith);
    font(10.5, "bold", C.navy); doc.text(text, M, y + 4); y += 6;
    if (sub) { font(8.5, "normal", C.muted); doc.text(sub, M, y + 3); y += 5; }
    y += 1;
  };
  const explanation = (text: string) => {
    font(9.5, "normal", C.text);
    const lines = doc.splitTextToSize(text, CONTENT_W - 10) as string[];
    const lh = 4;
    const h = lines.length * lh + 8;
    ensure(h);
    setFill(C.bg); setDraw(C.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, y, CONTENT_W, h, 1.5, 1.5, "FD");
    font(7.5, "bold", C.greenDark); doc.text("WHAT THIS SHOWS", M + 5, y + 4.8);
    font(9.5, "normal", C.text);
    lines.forEach((l, i) => doc.text(l, M + 5, y + 9.5 + i * lh));
    y += h + 8;
  };
  const noData = (h: number, msg: string) => {
    setFill(C.bg); doc.roundedRect(M, y, CONTENT_W, h, 1.5, 1.5, "F");
    font(9, "normal", C.faint); doc.text(msg, PAGE_W / 2, y + h / 2 + 1, { align: "center" });
    y += h + 4;
  };
  const legend = (items: [string, RGB][], x0 = M) => {
    let x = x0;
    font(7.5, "normal", C.muted);
    for (const [label, col] of items) { setFill(col); doc.rect(x, y - 2.2, 3, 3, "F"); doc.text(label, x + 4.2, y); x += doc.getTextWidth(label) + 10; }
    y += 5;
  };

  // Horizontal bar chart (0-100%) with a target line.
  const hBarChart = (items: { label: string; value: number | null; note?: string }[]) => {
    const labelW = 58, valueW = 16, barX = M + labelW, barW = CONTENT_W - labelW - valueW;
    const rowH = 7.5, h = items.length * rowH + 10;
    ensure(h + 6);
    const top = y;
    // grid
    font(7, "normal", C.faint);
    for (const g of [0, 25, 50, 75, 100]) {
      const gx = barX + (g / 100) * barW;
      setDraw(g === TARGET ? C.red : C.border); doc.setLineWidth(g === TARGET ? 0.35 : 0.15);
      if (g === TARGET) doc.setLineDashPattern([1.2, 1], 0);
      doc.line(gx, top, gx, top + items.length * rowH);
      doc.setLineDashPattern([], 0);
      doc.text(`${g}%`, gx, top + items.length * rowH + 4, { align: "center" });
    }
    font(7, "bold", C.red); doc.text(`${TARGET}% target`, barX + (TARGET / 100) * barW + 1, top - 1.2);
    items.forEach((it, i) => {
      const ry = top + i * rowH;
      font(8.5, "normal", C.text);
      const label = fit(it.label, labelW - 3);
      doc.text(label, M, ry + rowH / 2 + 1.3);
      if (it.value === null) {
        font(7.5, "normal", C.faint); doc.text(it.note || "No lectures in this period", barX + 2, ry + rowH / 2 + 1.2);
      } else {
        setFill(colourFor(it.value));
        doc.roundedRect(barX, ry + 1.5, Math.max(0.8, (it.value / 100) * barW), rowH - 3, 0.8, 0.8, "F");
        font(8.5, "bold", C.navy); doc.text(p1(it.value), barX + barW + valueW, ry + rowH / 2 + 1.3, { align: "right" });
      }
    });
    y = top + h;
    legend([[`${TARGET}% or more`, C.green], ["50-74%", C.orange], ["Below 50%", C.red]]);
  };

  // Vertical bar chart (values 0-100 or counts).
  const vBarChart = (items: { label: string; value: number | null; colour?: RGB }[], opts: { max: number; suffix: string; target?: number; height?: number }) => {
    const h = opts.height ?? 52, axisW = 10, chartX = M + axisW, chartW = CONTENT_W - axisW - (opts.target !== undefined ? 16 : 0), labelH = 9;
    ensure(h + labelH + 6);
    const top = y + 3, base = top + h;
    font(7, "normal", C.faint);
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (opts.max / steps) * i; const gy = base - (v / opts.max) * h;
      setDraw(C.border); doc.setLineWidth(0.15); doc.line(chartX, gy, chartX + chartW, gy);
      doc.text(`${Math.round(v)}${opts.suffix}`, chartX - 1.5, gy + 1, { align: "right" });
    }
    if (opts.target !== undefined) {
      const ty = base - (opts.target / opts.max) * h;
      setDraw(C.red); doc.setLineWidth(0.35); doc.setLineDashPattern([1.2, 1], 0); doc.line(chartX, ty, chartX + chartW, ty); doc.setLineDashPattern([], 0);
      font(7, "bold", C.red); doc.text(`${opts.target}% target`, chartX + chartW + 1, ty + 1, { align: "left" });
    }
    const n = Math.max(items.length, 1), slot = chartW / n, bw = Math.min(slot * 0.62, 18);
    const labelEvery = Math.ceil(n / 16);
    items.forEach((it, i) => {
      const cx = chartX + slot * i + slot / 2;
      if (it.value !== null) {
        const bh = (it.value / opts.max) * h;
        setFill(it.colour || colourFor(it.value)); doc.rect(cx - bw / 2, base - bh, bw, bh, "F");
        if (n <= 20) { font(7, "bold", C.navy); doc.text(`${Math.round(it.value)}${opts.suffix}`, cx, base - bh - 1.2, { align: "center" }); }
      }
      if (i % labelEvery === 0) { font(7, "normal", C.muted); doc.text(it.label, cx, base + 4, { align: "center" }); }
    });
    y = base + labelH;
  };

  // Line chart for the attendance trend.
  const lineChart = (pts: { label: string; value: number | null }[]) => {
    const h = 50, axisW = 10, chartX = M + axisW, chartW = CONTENT_W - axisW - 17;
    ensure(h + 16);
    const top = y + 3, base = top + h;
    font(7, "normal", C.faint);
    for (const g of [0, 25, 50, 75, 100]) {
      const gy = base - (g / 100) * h;
      setDraw(g === TARGET ? C.red : C.border); doc.setLineWidth(g === TARGET ? 0.35 : 0.15);
      if (g === TARGET) doc.setLineDashPattern([1.2, 1], 0);
      doc.line(chartX, gy, chartX + chartW, gy); doc.setLineDashPattern([], 0);
      doc.text(`${g}%`, chartX - 1.5, gy + 1, { align: "right" });
    }
    font(7, "bold", C.red); doc.text(`${TARGET}% target`, chartX + chartW + 1, base - (TARGET / 100) * h + 1);
    const n = pts.length;
    const pad = 8;
    const xAt = (i: number) => (n === 1 ? chartX + chartW / 2 : chartX + pad + (i / (n - 1)) * (chartW - pad * 2));
    const yAt = (v: number) => base - (v / 100) * h;
    setDraw(C.navy); doc.setLineWidth(0.7);
    let prev: [number, number] | null = null;
    pts.forEach((p, i) => {
      if (p.value === null) { prev = null; return; }
      const pt: [number, number] = [xAt(i), yAt(p.value)];
      if (prev) doc.line(prev[0], prev[1], pt[0], pt[1]);
      prev = pt;
    });
    pts.forEach((p, i) => {
      if (p.value === null) return;
      setFill(colourFor(p.value)); setDraw(C.white); doc.setLineWidth(0.4);
      doc.circle(xAt(i), yAt(p.value), 1.3, "FD");
      if (n <= 14) { font(6.5, "bold", C.navy); doc.text(`${Math.round(p.value)}%`, xAt(i), yAt(p.value) - 2.4, { align: "center" }); }
    });
    const labelEvery = Math.ceil(n / 12);
    font(7, "normal", C.muted);
    pts.forEach((p, i) => { if (i % labelEvery === 0 || i === n - 1) doc.text(p.label, xAt(i), base + 4.5, { align: "center" }); });
    y = base + 10;
  };

  // Stacked progress bars (completed / in progress / not started).
  const progressBars = (items: MisSubject[]) => {
    const labelW = 58, valueW = 22, barX = M + labelW, barW = CONTENT_W - labelW - valueW, rowH = 8;
    const h = items.length * rowH + 2;
    ensure(h + 10);
    const top = y;
    items.forEach((s, i) => {
      const ry = top + i * rowH;
      font(8.5, "normal", C.text);
      doc.text(fit(s.name, labelW - 3), M, ry + rowH / 2 + 1.3);
      if (s.modulesTotal === 0) { font(7.5, "normal", C.faint); doc.text("No modules set up", barX + 2, ry + rowH / 2 + 1.2); return; }
      let x = barX;
      const segs: [number, RGB][] = [[s.completed, C.green], [s.inProgress, C.orange], [s.notStarted, C.grey]];
      for (const [count, col] of segs) {
        if (!count) continue;
        const w = (count / s.modulesTotal) * barW;
        setFill(col); doc.rect(x, ry + 1.5, w, rowH - 3, "F");
        if (w > 6) { font(7, "bold", col === C.grey ? C.muted : C.white); doc.text(String(count), x + w / 2, ry + rowH / 2 + 1.2, { align: "center" }); }
        x += w;
      }
      font(8.5, "bold", C.navy); doc.text(`${s.completed}/${s.modulesTotal}  ${s.progressPct}%`, barX + barW + valueW, ry + rowH / 2 + 1.3, { align: "right" });
    });
    y = top + h + 2;
    legend([["Completed", C.green], ["In progress", C.orange], ["Not started", C.grey]]);
  };

  // Simple table with repeating header on page breaks.
  const table = (cols: { label: string; w: number; align?: "left" | "center" | "right" }[], rows: (string | { text: string; colour?: RGB; bold?: boolean })[][]) => {
    const rowH = 6.5;
    const drawHeader = () => {
      setFill(C.navy); doc.rect(M, y, CONTENT_W, rowH + 0.5, "F");
      font(8, "bold", C.white);
      let x = M;
      for (const c of cols) {
        const tx = c.align === "right" ? x + c.w - 2 : c.align === "center" ? x + c.w / 2 : x + 2;
        doc.text(c.label, tx, y + 4.5, { align: c.align || "left" }); x += c.w;
      }
      y += rowH + 0.5;
    };
    ensure(rowH * 3); drawHeader();
    rows.forEach((r, ri) => {
      if (y + rowH > PAGE_H - 18) { newPage(); drawHeader(); }
      if (ri % 2 === 1) { setFill(C.bg); doc.rect(M, y, CONTENT_W, rowH, "F"); }
      let x = M;
      r.forEach((cell, ci) => {
        const c = cols[ci];
        const obj = typeof cell === "string" ? { text: cell } : cell;
        font(8.3, obj.bold ? "bold" : "normal", obj.colour || C.text);
        const txt = fit(obj.text, c.w - 3);
        const tx = c.align === "right" ? x + c.w - 2 : c.align === "center" ? x + c.w / 2 : x + 2;
        doc.text(txt, tx, y + 4.4, { align: c.align || "left" });
        x += c.w;
      });
      setDraw(C.border); doc.setLineWidth(0.15); doc.line(M, y + rowH, M + CONTENT_W, y + rowH);
      y += rowH;
    });
    y += 6;
  };

  const kpi = (x: number, w: number, label: string, value: string, sub: string, accent: RGB) => {
    const h = 25;
    setFill(C.white); setDraw(C.border); doc.setLineWidth(0.25); doc.roundedRect(x, y, w, h, 2, 2, "FD");
    setFill(accent); doc.rect(x, y + 3, 1.2, h - 6, "F");
    font(7.5, "bold", C.muted); doc.text(label.toUpperCase(), x + 4.5, y + 6.5);
    font(16, "bold", C.navy); doc.text(value, x + 4.5, y + 15);
    font(7.5, "normal", C.muted); doc.text(doc.splitTextToSize(sub, w - 7)[0] as string, x + 4.5, y + 21);
  };

  // ── COVER BAND ──
  setFill(C.navy); doc.rect(0, 0, PAGE_W, 48, "F");
  setFill(C.green); doc.rect(0, 48, PAGE_W, 1.4, "F");
  try {
    const res = await fetch("/ffoi-logo.png");
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
    setFill(C.white); doc.roundedRect(M, 11, 18, 18, 2, 2, "F");
    doc.addImage(dataUrl, "PNG", M + 2, 13, 14, 14);
  } catch { /* logo is optional; report still generates */ }
  font(9, "bold", C.green); doc.text("FINANCE FORUM OF INDIA", M + 23, 16.5);
  font(17, "bold", C.white); doc.text("MIS Report: Attendance & Course Progress", M + 23, 24.5);
  font(9.5, "normal", [199, 207, 212]);
  doc.text(`${d.batch.name}  |  ${scopeLabel}${d.scope ? `  |  ${d.scope.faculty}` : ""}`, M + 23, 31.5);
  doc.text(`${d.periodLabel}: ${rangeLabel}`, M + 23, 37);
  font(7.5, "normal", [143, 160, 174]);
  doc.text(`Generated ${new Date(d.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} IST`, M + 23, 42.5);
  y = 58;

  // ── KPIs ──
  const belowTarget = d.students.filter((s) => s.pct !== null && s.pct < TARGET);
  const gap = 4, kw = (CONTENT_W - gap * 3) / 4;
  const prevSub = d.overall.prevPct !== null && d.overall.pct !== null
    ? `${d.overall.pct - d.overall.prevPct >= 0 ? "+" : ""}${Math.round((d.overall.pct - d.overall.prevPct) * 10) / 10} pts vs ${prevLabel}`
    : `${d.studentCount} students in batch`;
  kpi(M, kw, "Avg attendance", p1(d.overall.pct), prevSub, colourFor(d.overall.pct));
  kpi(M + (kw + gap), kw, "Lectures held", String(d.overall.sessions), d.scope ? d.scope.courseName : `across ${d.subjects.length} subjects`, C.navy);
  kpi(M + (kw + gap) * 2, kw, "Syllabus done", `${d.progress.pct}%`, `${d.progress.modulesCompleted} of ${d.progress.modulesTotal} modules`, C.green);
  kpi(M + (kw + gap) * 3, kw, "Below 75%", String(belowTarget.length), `of ${d.studentCount} students`, belowTarget.length ? C.red : C.green);
  y += 32;

  // ── Key findings ──
  font(11, "bold", C.navy); doc.text("Key findings", M, y + 4); y += 8;
  const findings: string[] = [];
  if (d.overall.sessions === 0) findings.push("No lecture attendance was recorded in this period.");
  else findings.push(`Average lecture attendance was ${p1(d.overall.pct)} across ${plural(d.overall.sessions, "session")}.${change(d.overall.pct, d.overall.prevPct, prevLabel)}`);
  if (!d.scope && d.overall.sessions > 0) {
    const below = d.subjects.filter((s) => s.pct !== null && s.pct < TARGET).map((s) => s.name);
    findings.push(below.length ? `${below.length === 1 ? "One subject" : `${below.length} subjects`} fell below the ${TARGET}% attendance target: ${listNames(below)}.` : `All subjects with lectures met the ${TARGET}% attendance target.`);
  }
  if (d.overall.sessions > 0) findings.push(belowTarget.length ? `${plural(belowTarget.length, "student")} attended fewer than ${TARGET}% of lectures and need follow-up (see Section 1).` : `Every student attended at least ${TARGET}% of lectures.`);
  findings.push(`${d.progress.modulesCompleted} of ${d.progress.modulesTotal} modules (${d.progress.pct}%) are complete${d.period !== "overall" ? `, with ${plural(d.progress.completedInPeriod, "module")} finished in this period` : ""}.`);
  if (d.events && d.events.count > 0) findings.push(`${plural(d.events.count, "guest lecture/event", "guest lectures/events")} ${d.events.count === 1 ? "was" : "were"} held, with ${p1(d.events.pct)} attendance.`);
  for (const f of findings) {
    font(9.5, "normal", C.text);
    const lines = doc.splitTextToSize(f, CONTENT_W - 6) as string[];
    ensure(lines.length * 4.2 + 1.5);
    setFill(C.green); doc.circle(M + 1.2, y + 2.4, 0.9, "F");
    lines.forEach((l, i) => doc.text(l, M + 5, y + 3.4 + i * 4.2));
    y += lines.length * 4.2 + 1.8;
  }
  y += 4;
  paragraph(`How to read this report: attendance % = seats filled / (students in batch x lectures held). The ${TARGET}% line marks the minimum attendance target. Course progress reflects module statuses set by faculty in the Modules tab, as of the date this report was generated.`, 8.2, C.muted, 2);

  // ── SECTION 1: ATTENDANCE ──
  sectionTitle("1", "Attendance");

  if (d.scope) {
    const s = d.subjects[0];
    chartTitle("Attendance by lecture session", `${s.name}  |  ${plural(s.sessionsList.length, "session")}  |  ${d.studentCount} students`);
    if (s.sessionsList.length) vBarChart(s.sessionsList.map((x) => ({ label: fmtDate(x.date, { day: "2-digit", month: "short" }), value: x.pct })), { max: 100, suffix: "%", target: TARGET });
    else noData(30, "No lecture sessions recorded in this period");
    explanation(explainSessions(s));
  } else {
    chartTitle("Attendance by subject", `Average share of seats filled per subject  |  ${d.studentCount} students`);
    if (d.subjects.length) hBarChart(d.subjects.map((s) => ({ label: s.name, value: s.pct })));
    else noData(30, "No subjects in this batch");
    explanation(explainSubjectAttendance(d, prevLabel));
  }

  if (d.period !== "week" || d.trend.some((t) => t.pct !== null)) {
    chartTitle(`Attendance trend (${d.trendGranularity === "day" ? "daily" : d.trendGranularity === "week" ? "weekly, by week starting" : "monthly"})`);
    if (d.trend.some((t) => t.pct !== null)) lineChart(d.trend.map((t) => ({ label: t.label, value: t.pct })));
    else noData(30, "No attendance recorded in this period");
    explanation(explainTrend(d));
  }

  chartTitle("Students by attendance band", "Number of students in each attendance range");
  const bandItems = [
    { label: "Under 50%", value: d.bands.below50, colour: C.red },
    { label: "50-74%", value: d.bands.b50to74, colour: C.orange },
    { label: "75-89%", value: d.bands.b75to89, colour: [165, 205, 110] as RGB },
    { label: "90% +", value: d.bands.above90, colour: C.green },
  ];
  const bandMax = Math.max(4, ...bandItems.map((b) => b.value));
  if (d.overall.sessions > 0) vBarChart(bandItems, { max: Math.ceil(bandMax / 4) * 4, suffix: "", height: 40 });
  else noData(24, "No attendance recorded in this period");
  explanation(explainBands(d));

  if (!d.scope) {
    chartTitle("Subject-wise summary", undefined, 40);
    table(
      [
        { label: "Subject", w: 62 }, { label: "Faculty", w: 40 }, { label: "Lectures", w: 20, align: "center" },
        { label: "Attendance", w: 28, align: "center" }, { label: d.period === "overall" ? "Status" : "vs previous", w: CONTENT_W - 150, align: "center" },
      ],
      d.subjects.map((s) => {
        let last: { text: string; colour?: RGB; bold?: boolean };
        if (d.period === "overall") last = s.pct === null ? { text: "-", colour: C.faint } : s.pct >= TARGET ? { text: "On target", colour: C.greenDark, bold: true } : { text: "Below target", colour: C.red, bold: true };
        else if (s.pct === null || s.prevPct === null) last = { text: "-", colour: C.faint };
        else { const diff = Math.round((s.pct - s.prevPct) * 10) / 10; last = { text: `${diff >= 0 ? "+" : ""}${diff} pts`, colour: diff >= 0 ? C.greenDark : C.red, bold: true }; }
        return [s.name, s.faculty, String(s.sessions), { text: p1(s.pct), colour: colourFor(s.pct), bold: true }, last];
      })
    );
    if (d.events) {
      paragraph(d.events.count
        ? `Guest lectures & events (not included in subject figures above): ${plural(d.events.count, "event")} held, ${d.events.present} of ${d.events.possible} possible attendances (${p1(d.events.pct)}).`
        : "Guest lectures & events: none were held in this period.", 8.8, C.muted, 4);
    }
  }

  chartTitle(`Follow-up list: students below ${TARGET}%`, belowTarget.length ? "Sorted from lowest attendance" : undefined, 40);
  if (d.overall.sessions === 0) paragraph("No lectures were recorded in this period.", 9, C.muted);
  else if (belowTarget.length === 0) paragraph(`No student is below ${TARGET}% attendance in this period.`, 9, C.greenDark);
  else table(
    [{ label: "#", w: 10, align: "center" }, { label: "Student", w: 90 }, { label: "Lectures attended", w: 45, align: "center" }, { label: "Attendance", w: CONTENT_W - 145, align: "center" }],
    [...belowTarget].sort((a, b) => a.pct! - b.pct!).map((s, i) => [String(i + 1), s.name, `${s.attended} of ${s.possible}`, { text: p1(s.pct), colour: colourFor(s.pct), bold: true }])
  );

  // ── SECTION 2: COURSE PROGRESS ──
  sectionTitle("2", "Course progress");
  chartTitle(d.scope ? "Syllabus progress" : "Syllabus progress by subject", "Module status as of today");
  progressBars(d.subjects);
  explanation(explainProgress(d));

  if (d.scope) {
    chartTitle("Module status", undefined, 40);
    const s = d.subjects[0];
    const statusText: Record<string, [string, RGB]> = { completed: ["Completed", C.greenDark], in_progress: ["In progress", C.orange], not_started: ["Not started", C.muted] };
    table(
      [{ label: "Module", w: 18, align: "center" }, { label: "Name", w: 98 }, { label: "Status", w: 32, align: "center" }, { label: "Completed on", w: CONTENT_W - 148, align: "center" }],
      s.modules.map((m) => [String(m.number), m.name || "(name not added)", { text: statusText[m.status]?.[0] || m.status, colour: statusText[m.status]?.[1], bold: true }, m.completed ? fmtDate(m.completed) : "-"])
    );
  } else {
    chartTitle("Subject-wise progress", undefined, 40);
    table(
      [
        { label: "Subject", w: 66 }, { label: "Completed", w: 24, align: "center" }, { label: "In progress", w: 24, align: "center" },
        { label: "Not started", w: 24, align: "center" }, { label: d.period === "overall" ? "Progress" : "Done this period", w: CONTENT_W - 138, align: "center" },
      ],
      d.subjects.map((s) => [
        s.name, `${s.completed}/${s.modulesTotal}`, String(s.inProgress), String(s.notStarted),
        d.period === "overall" ? { text: `${s.progressPct}%`, bold: true, colour: C.navy } : { text: String(s.completedInPeriod), bold: true, colour: s.completedInPeriod ? C.greenDark : C.muted },
      ])
    );
  }

  // ── footers ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(C.border); doc.setLineWidth(0.3); doc.line(M, PAGE_H - 12, PAGE_W - M, PAGE_H - 12);
    font(7.5, "normal", C.faint);
    doc.text("Finance Forum of India Portal  |  Confidential: for internal management use", M, PAGE_H - 7.5);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M, PAGE_H - 7.5, { align: "right" });
  }

  const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 40);
  const periodSlug = d.period === "week" ? "Last7Days" : d.period === "month" ? "Last30Days" : "Overall";
  const filename = `FFOI_MIS_${safe(d.batch.name)}_${safe(scopeLabel)}_${periodSlug}_${d.endDate}.pdf`;
  return { doc, filename };
}

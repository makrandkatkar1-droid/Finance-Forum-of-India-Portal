"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import * as XLSX from "xlsx";
import type { MisData } from "@/lib/misReport";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  LayoutDashboard, BookOpen, CheckCircle2, CalendarDays, ClipboardList,
  FileText, Award, History, LogOut, Users, TrendingUp, Clock,
  ChevronRight, ChevronLeft, CalendarClock, CalendarRange, Settings,
  ClipboardCheck, Bell, X, Download, Wallet, Receipt, Layers, Plus, CheckCircle,
  Save, Trash2, FileChartColumn, TriangleAlert, GraduationCap, ArrowUp, ArrowDown, Pencil, UserPlus, Star,
} from "lucide-react";

const THEME = {
  green: "#7BBA27", greenDark: "#5C9420", greenLight: "#EAF5DA",
  navy: "#0B1D2E", navyLight: "#16283C", navySoft: "#1F344A",
  bg: "#F5F6F1", card: "#FFFFFF", border: "#E4E1D8",
  textMuted: "#6B6A63", textFaint: "#9B9A92",
  purple: "#6E56A8", purpleLight: "#EEE9F7",
  orange: "#C5761F", orangeLight: "#FBEDDB",
};
const DAYS_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const GLOBAL_TABS = ["org", "monthly", "weekly-sched", "subjects", "credentials", "audit", "batches", "payout", "fees", "myresults", "reports"];
// Subjects created before semesters existed have no semester; treat them as the first one.
function semesterOf(c: CourseSummary, sems: Semester[]) { return c.semester_id || sems[0]?.id || null; }

type SessionUser = { id: string; name: string; username: string; role: string; courseId?: string | null; studentId?: string | null; batchId?: string | null };
type Batch = { id: string; name: string };
type CourseSummary = { id: string; name: string; code: string; day_allocated: string | null; day_parity: string | null; total_hours: number | null; batch_id: string; results_published: boolean; faculty_name: string; faculty_id: string; semester_id: string | null; external_max_marks: number };
type Semester = { id: string; name: string; semester_number: number; is_current: boolean; subject_count: number };
type ModuleRow = { id: string; module_number: number; module_name: string | null; status: string; completed_date: string | null };
type WeeklyPlanRow = { id: string; week_number: number; week_start_date: string; session_type: string; activity_name: string | null; topics: string; module_id: string | null };
type AssignmentRow = { id: string; title: string; description: string | null; deadline: string };
type TestRow = { id: string; test_type: string; test_date: string };
type ComponentRow = { id: string; component_name: string; max_marks: number; display_order: number };
type AttendanceSession = { id: string; session_date: string };
type StudentRow = { id: string; label: string; name: string; seat_number: number; username: string; fee_category: string };
type CourseDetail = {
  course: CourseSummary;
  modules: ModuleRow[];
  weeklyPlans: WeeklyPlanRow[];
  assignments: AssignmentRow[];
  tests: TestRow[];
  components: ComponentRow[];
  scores: Record<string, Record<string, number>>;
  summativeMarks: Record<string, number>;
  attendanceSessions: AttendanceSession[];
  attendanceRecords: Record<string, Record<string, boolean>>;
  canEdit: boolean;
};
type AuditEntry = { id: string; actor_name: string; action: string; changed_at: string };

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: "#F1EFE8", text: "#5F5E5A", label: "Not started" },
  in_progress: { bg: "#FAEEDA", text: "#854F0B", label: "In progress" },
  completed: { bg: "#EAF3DE", text: "#3B6D11", label: "Completed" },
};

function isAttendanceComponent(name: string) { return name.toLowerCase().includes("attendance"); }
function weekParityLabel(parity: string | null) {
  if (parity === "odd") return "Odd weeks";
  if (parity === "even") return "Even weeks";
  return null;
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysInMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function mondayIndex(jsDay: number) { return (jsDay + 6) % 7; }

function computeFormativeTotal(detail: CourseDetail, studentId: string) {
  const row = detail.scores[studentId] || {};
  return detail.components.reduce((sum, comp) => {
    if (isAttendanceComponent(comp.component_name)) {
      const total = detail.attendanceSessions.length;
      const present = Object.values(detail.attendanceRecords[studentId] || {}).filter(Boolean).length;
      return sum + (total ? Math.round((present / total) * comp.max_marks) : 0);
    }
    return sum + (Number(row[comp.id]) || 0);
  }, 0);
}

// Totals follow each subject's own internal pattern and external marks.
function formativeMax(detail: CourseDetail) { return detail.components.reduce((sum, c) => sum + Number(c.max_marks || 0), 0); }
function externalMax(course: CourseSummary) { return Number(course.external_max_marks ?? 50); }

async function api(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// SAVE SYSTEM
// Edits are held as a draft until the user clicks Save. Leaving a page
// (switching tab/course, logging out, closing the browser) with unsaved
// changes asks for confirmation first.
// ─────────────────────────────────────────────────────────────
const dirtyPanels = new Set<string>();

function confirmLeave(): boolean {
  if (dirtyPanels.size === 0) return true;
  const ok = window.confirm("You have unsaved changes. Leave without saving them?");
  if (ok) dirtyPanels.clear();
  return ok;
}

type DraftChange = { value: any; commit: (value: any) => Promise<unknown> };
type Draft = ReturnType<typeof useDraft>;

function useDraft(panelId: string, onSaved?: () => unknown) {
  const [changes, setChanges] = useState<Record<string, DraftChange>>({});
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const count = Object.keys(changes).length;

  useEffect(() => {
    if (count > 0) dirtyPanels.add(panelId); else dirtyPanels.delete(panelId);
    return () => { dirtyPanels.delete(panelId); };
  }, [count, panelId]);

  useEffect(() => {
    if (count === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  // Stage a change. If the new value equals the original, the change is dropped.
  const stage = useCallback((key: string, value: any, commit: (value: any) => Promise<unknown>, original?: any) => {
    setStatus((s) => (s === "saved" ? "idle" : s));
    setChanges((c) => {
      if (original !== undefined && String(value ?? "") === String(original ?? "")) {
        if (!(key in c)) return c;
        const next = { ...c }; delete next[key]; return next;
      }
      return { ...c, [key]: { value, commit } };
    });
  }, []);

  const drop = useCallback((match: (key: string) => boolean) => {
    setChanges((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !match(k))));
  }, []);

  const get = <T,>(key: string, fallback: T): T => (key in changes ? changes[key].value : fallback);
  const has = (key: string) => key in changes;

  const save = async () => {
    const entries = Object.entries(changes);
    if (entries.length === 0) return;
    setStatus("saving"); setError("");
    const failed: Record<string, DraftChange> = {};
    let firstError = "";
    // Run up to 6 saves at a time so large edits (e.g. a full attendance sheet) stay quick.
    const queue = [...entries];
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) {
        const [key, ch] = queue.shift()!;
        try { await ch.commit(ch.value); } catch (e: any) { failed[key] = ch; firstError ||= e?.message || "Save failed"; }
      }
    }));
    try { await onSaved?.(); } catch { /* reload failure shouldn't hide the save result */ }
    setChanges(failed);
    setVersion((v) => v + 1);
    const failedCount = Object.keys(failed).length;
    if (failedCount) {
      setStatus("error");
      setError(`${failedCount} change${failedCount > 1 ? "s" : ""} could not be saved: ${firstError}`);
    } else {
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    }
  };

  const discard = () => { setChanges({}); setVersion((v) => v + 1); setStatus("idle"); setError(""); };

  return { stage, drop, get, has, save, discard, count, version, status, error };
}

function SaveBar({ draft, compact = false }: { draft: Draft; compact?: boolean }) {
  const dirty = draft.count > 0;
  const saving = draft.status === "saving";
  let message: ReactNode;
  if (saving) message = "Saving…";
  else if (draft.status === "error") message = <span style={{ color: "#A32D2D" }}>{draft.error}</span>;
  else if (dirty) message = <span style={{ color: THEME.orange, fontWeight: 600 }}>{draft.count} unsaved change{draft.count > 1 ? "s" : ""}</span>;
  else if (draft.status === "saved") message = <span style={{ color: THEME.greenDark, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><CheckCircle size={14} /> Saved</span>;
  else message = <span style={{ color: THEME.textFaint }}>All changes saved</span>;

  return (
    <div style={{
      position: compact ? "static" : "sticky", bottom: compact ? undefined : 12, zIndex: 15,
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
      marginTop: compact ? 10 : 16, padding: compact ? "8px 10px" : "10px 14px", borderRadius: 10,
      border: `1px solid ${dirty ? THEME.orange : THEME.border}`, background: dirty ? "#FFFBF4" : THEME.card,
      boxShadow: dirty && !compact ? "0 6px 20px rgba(11,29,46,0.12)" : "none", fontSize: 12.5,
    }}>
      <div>{message}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {dirty && !saving && (
          <button onClick={draft.discard} style={{ padding: "7px 14px", borderRadius: 7, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 12.5, cursor: "pointer", color: THEME.textMuted }}>Discard</button>
        )}
        <button onClick={draft.save} disabled={!dirty || saving}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 18px", borderRadius: 7, border: "none", fontSize: 12.5, fontWeight: 700,
            background: dirty ? THEME.green : "#DCDAD2", color: dirty ? "white" : THEME.textFaint, cursor: dirty && !saving ? "pointer" : "default" }}>
          <Save size={14} /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// Style applied to an input whose value has changed but isn't saved yet.
const dirtyStyle = (isDirty: boolean) => (isDirty ? { borderColor: THEME.orange, background: "#FFF7EA" } : {});

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const [allCourses, setAllCourses] = useState<CourseSummary[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [activeTab, setActiveTab] = useState<string>("home");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Who am I, and which batches may I see? Students and faculty are locked to
  // their own batch(es) by the server; only the admin can switch freely.
  useEffect(() => {
    api("/api/auth/me").then(async (d) => {
      if (!d.user) { router.replace("/"); return; }
      setUser(d.user);
      const list: Batch[] = (await api("/api/batches")).batches || [];
      setBatches(list);
      const stored = typeof window !== "undefined" ? localStorage.getItem("ffoi_batch_id") : null;
      const preferred = d.user.role === "student" ? d.user.batchId : stored;
      const chosen = list.find((b) => b.id === preferred)?.id ?? list[0]?.id ?? null;
      setBatchId(chosen);
      if (!chosen) setLoading(false);
    });
  }, [router]);

  const loadCourses = useCallback(async (bId: string) => {
    const d = await api(`/api/courses?batchId=${bId}`);
    setAllCourses(d.courses || []);
    return (d.courses || []) as CourseSummary[];
  }, []);

  const loadStudents = useCallback(async (bId: string) => {
    const d = await api(`/api/students?batchId=${bId}`);
    setStudents(d.students || []);
  }, []);

  const loadSemesters = useCallback(async (bId: string) => {
    const d = await api(`/api/semesters?batchId=${bId}`);
    setSemesters(d.semesters || []);
    return (d.semesters || []) as Semester[];
  }, []);

  // Load everything for the batch, then open the right semester:
  // the one this person last looked at, else the current semester.
  useEffect(() => {
    if (!user || !batchId) return;
    (async () => {
      const [cs, sems] = await Promise.all([loadCourses(batchId), loadSemesters(batchId), loadStudents(batchId)]);
      const stored = typeof window !== "undefined" ? localStorage.getItem(`ffoi_semester_${batchId}`) : null;
      const hasMine = (sid: string) => cs.some((c) => semesterOf(c, sems) === sid);
      const current = sems.find((s) => s.is_current);
      let pick: string | null = null;
      if (stored && sems.some((s) => s.id === stored)) pick = stored;
      else if (current && (user.role === "admin" || hasMine(current.id))) pick = current.id;
      else pick = ([...sems].reverse().find((s) => hasMine(s.id)) || current || sems[0])?.id ?? null;
      setSemesterId(pick);
      setLoading(false);
    })();
  }, [user, batchId, loadCourses, loadSemesters, loadStudents]);

  // Subjects of the selected semester. Every screen below works on this list.
  const courses = useMemo(
    () => allCourses.filter((c) => semesterOf(c, semesters) === semesterId),
    [allCourses, semesters, semesterId]
  );

  // Keep the open subject inside the selected semester.
  useEffect(() => {
    setActiveCourseId((prev) => (prev && courses.some((c) => c.id === prev) ? prev : courses[0]?.id ?? null));
  }, [courses]);

  const loadDetail = useCallback(async (courseId: string) => {
    const d = await api(`/api/courses/${courseId}`);
    setDetail(d);
  }, []);

  useEffect(() => {
    if (activeCourseId) loadDetail(activeCourseId).catch(() => setDetail(null));
    else setDetail(null);
  }, [activeCourseId, refreshKey, loadDetail]);

  useEffect(() => {
    if (activeTab === "audit" && user?.role === "admin") {
      api("/api/audit-log").then((d) => setAuditLog(d.log || []));
    }
  }, [activeTab, user]);

  const refresh = () => setRefreshKey((k) => k + 1);
  // Awaitable reload of the open course, used after a Save so fresh values are on screen.
  const reloadDetail = async () => { const id = activeCourseId; if (id) await loadDetail(id); };

  // Every navigation goes through here so unsaved changes are never lost silently.
  const go = (fn: () => void) => { if (confirmLeave()) fn(); };
  const openTab = (tab: string) => go(() => setActiveTab(tab));
  const openCourse = (id: string) => go(() => {
    const c = allCourses.find((x) => x.id === id);
    const sid = c ? semesterOf(c, semesters) : null;
    if (sid && sid !== semesterId) setSemesterId(sid);
    setActiveCourseId(id); setActiveTab("home"); refresh();
  });

  async function handleLogout() {
    if (!confirmLeave()) return;
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  // Only offered to people who can see more than one batch (the admin, or a
  // faculty member who teaches in two batches) — the server enforces the rest.
  const changeBatch = (id: string) => go(() => {
    if (typeof window !== "undefined") localStorage.setItem("ffoi_batch_id", id);
    setLoading(true); setActiveCourseId(null); setDetail(null);
    if (!GLOBAL_TABS.includes(activeTab)) setActiveTab("home");
    setBatchId(id);
  });

  const changeSemester = (id: string) => go(() => {
    if (typeof window !== "undefined" && batchId) localStorage.setItem(`ffoi_semester_${batchId}`, id);
    setSemesterId(id);
    if (!GLOBAL_TABS.includes(activeTab)) setActiveTab("home");
  });

  const reloadBatchSetup = async () => { if (batchId) await Promise.all([loadCourses(batchId), loadSemesters(batchId)]); refresh(); };
  const reloadBatches = async () => {
    const list: Batch[] = (await api("/api/batches")).batches || [];
    setBatches(list);
    if (!batchId && list[0]) setBatchId(list[0].id);
  };

  if (!user || batches === null || (loading && batchId)) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: THEME.bg, color: THEME.textMuted }}>Loading portal...</div>;
  }

  if (!batchId) {
    return (
      <div style={{ minHeight: "100vh", background: THEME.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          {user.role === "admin" ? <BatchesPanel batches={batches} onChanged={reloadBatches} /> : (
            <div style={{ padding: 24, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, fontSize: 14, color: THEME.navy }}>
              Your account is not linked to a batch yet. Please contact the Operations team.
            </div>
          )}
          <button onClick={handleLogout} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer", fontSize: 13 }}>Log out</button>
        </div>
      </div>
    );
  }

  const courseId = activeCourseId;
  const canEdit = detail?.canEdit ?? false;
  const isAdmin = user.role === "admin";
  const batchName = batches.find((b) => b.id === batchId)?.name || "";
  const semester = semesters.find((s) => s.id === semesterId) || null;
  const scopeName = semester ? `${batchName} · ${semester.name}` : batchName;

  const navSections = user.role === "student"
    ? ["home", "modules", "plan", "assignments", "tests"]
    : ["home", "modules", "plan", "assignments", "tests", "marks", "attendance"];

  const NAV_META: Record<string, { label: string; icon: any }> = {
    home: { label: "Overview", icon: LayoutDashboard },
    modules: { label: "Modules", icon: BookOpen },
    plan: { label: "Weekly plan", icon: CalendarDays },
    assignments: { label: "Assignments", icon: ClipboardList },
    tests: { label: "Tests", icon: FileText },
    marks: { label: "Marks", icon: Award },
    attendance: { label: "Attendance", icon: ClipboardCheck },
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: THEME.bg }}>
      <Sidebar
        user={user} courses={courses} activeCourseId={courseId}
        batches={batches} batchId={batchId} onChangeBatch={changeBatch}
        semesters={semesters} semesterId={semesterId} onChangeSemester={changeSemester}
        onSelectCourse={openCourse}
        onLogout={handleLogout} activeTab={activeTab}
        onOpenTab={openTab}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 32px 60px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <NotificationBell />
          </div>

          {activeTab === "org" && isAdmin && <OrgDashboard courses={courses} batchId={batchId} semesterId={semesterId} scopeName={scopeName} onSelectCourse={openCourse} onOpenReports={() => openTab("reports")} />}
          {activeTab === "reports" && isAdmin && <MisReports courses={courses} batchId={batchId} semesterId={semesterId} batchName={scopeName} />}
          {activeTab === "monthly" && <MonthlyCalendar courses={courses} isAdmin={isAdmin} batchId={batchId} students={students} onChanged={refresh} />}
          {activeTab === "weekly-sched" && (
            <WeeklyCalendar courses={courses} user={user}
              onSaved={() => loadCourses(batchId)}
              onSelectCourse={openCourse} />
          )}
          {activeTab === "subjects" && isAdmin && (
            <SubjectsPanel batchId={batchId} batchName={batchName} semesters={semesters} courses={allCourses}
              selectedSemesterId={semesterId} onSelectSemester={changeSemester}
              onChanged={reloadBatchSetup} onOpenCourse={openCourse} onOpenCredentials={() => openTab("credentials")} />
          )}
          {activeTab === "credentials" && isAdmin && <CredentialsPanel batchId={batchId} students={students} onStudentsChanged={() => loadStudents(batchId)} onFacultyChanged={reloadBatchSetup} />}
          {activeTab === "audit" && isAdmin && <AuditLog log={auditLog} />}
          {activeTab === "batches" && isAdmin && <BatchesPanel batches={batches} onChanged={reloadBatches} />}
          {activeTab === "payout" && isAdmin && <FacultyPayout batchId={batchId} />}
          {activeTab === "fees" && isAdmin && <StudentFees batchId={batchId} students={students} onStudentsChanged={() => loadStudents(batchId)} />}
          {activeTab === "myresults" && user.role === "student" && <MyResults courses={courses} studentId={user.studentId!} />}

          {!GLOBAL_TABS.includes(activeTab) && !courseId && (
            <div style={{ padding: 28, border: `1px dashed ${THEME.border}`, borderRadius: 12, background: THEME.card, textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: THEME.navy }}>{semester ? `No subjects in ${semester.name} yet` : "No subjects yet"}</div>
              <div style={{ fontSize: 13, color: THEME.textMuted, marginTop: 6 }}>
                {isAdmin ? "Add subjects for this semester from Semesters & subjects." : user.role === "faculty" ? "You have no subjects assigned in this semester. Pick another semester in the sidebar." : "Subjects for this semester haven't been added yet."}
              </div>
              {isAdmin && (
                <button onClick={() => openTab("subjects")} style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  <GraduationCap size={15} /> Open Semesters & subjects
                </button>
              )}
            </div>
          )}

          {!GLOBAL_TABS.includes(activeTab) && courseId && detail && detail.course.id === courseId && (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>{detail.course.name}</div>
                <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>
                  {[detail.course.faculty_name,
                    detail.course.day_allocated ? `${detail.course.day_allocated}s${weekParityLabel(detail.course.day_parity) ? ` (${weekParityLabel(detail.course.day_parity)})` : ""}` : null,
                    detail.course.total_hours ? `${detail.course.total_hours} hours` : null,
                    semester?.name].filter(Boolean).join(" · ")}
                  {!canEdit && user.role !== "student" && <span style={{ marginLeft: 10, padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#F1EFE8", color: THEME.textMuted }}>View only</span>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: `1px solid ${THEME.border}`, overflowX: "auto" }}>
                {navSections.map((key) => {
                  const meta = NAV_META[key]; const Icon = meta.icon;
                  return (
                    <button key={key} onClick={() => openTab(key)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", fontSize: 13.5, background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap",
                        borderBottom: activeTab === key ? `2.5px solid ${THEME.green}` : "2.5px solid transparent",
                        color: activeTab === key ? THEME.navy : THEME.textMuted, fontWeight: activeTab === key ? 600 : 500 }}>
                      <Icon size={15} />{meta.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === "home" && <Overview detail={detail} />}
              {activeTab === "modules" && <Modules detail={detail} courseId={courseId} onRefresh={reloadDetail} />}
              {activeTab === "plan" && <WeeklyPlan detail={detail} courseId={courseId} onRefresh={refresh} />}
              {activeTab === "assignments" && <Assignments detail={detail} courseId={courseId} onRefresh={refresh} />}
              {activeTab === "tests" && <Tests detail={detail} courseId={courseId} onRefresh={refresh} />}
              {activeTab === "marks" && user.role !== "student" && <Marks detail={detail} students={students} courseId={courseId} isAdmin={isAdmin} onRefresh={reloadDetail} />}
              {activeTab === "attendance" && user.role !== "student" && <Attendance detail={detail} students={students} courseId={courseId} onRefresh={reloadDetail} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ user, courses, activeCourseId, batches, batchId, onChangeBatch, semesters, semesterId, onChangeSemester, onSelectCourse, onLogout, activeTab, onOpenTab }: {
  user: SessionUser; courses: CourseSummary[]; activeCourseId: string | null;
  batches: Batch[]; batchId: string; onChangeBatch: (id: string) => void;
  semesters: Semester[]; semesterId: string | null; onChangeSemester: (id: string) => void;
  onSelectCourse: (id: string) => void; onLogout: () => void; activeTab: string; onOpenTab: (tab: string) => void;
}) {
  const roleLabel: Record<string, string> = { admin: "Operations Head", faculty: "Faculty", student: "Student" };
  const GlobalBtn = ({ tab, icon: Icon, label }: any) => {
    const active = activeTab === tab;
    return (
      <button onClick={() => onOpenTab(tab)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 8,
        background: active ? THEME.navySoft : "transparent", border: "none", cursor: "pointer",
        color: active ? "#FFFFFF" : "#B7C2CB", fontSize: 13.5, fontWeight: 600, textAlign: "left" }}>
        <Icon size={16} />{label}
      </button>
    );
  };
  const isAdmin = user.role === "admin";
  const batchName = batches.find((b) => b.id === batchId)?.name || "";
  const semesterName = semesters.find((s) => s.id === semesterId)?.name || "";
  const pickerStyle = { width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 7, border: "1px solid #2A3D50", background: THEME.navyLight, color: "#EDEFEA", fontSize: 12.5, fontWeight: 600 };

  return (
    <div style={{ width: 260, flexShrink: 0, background: THEME.navy, color: "#EDEFEA", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 20px 18px" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Image src="/ffoi-logo.png" alt="FFOI logo" width={26} height={26} />
        </div>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#FFFFFF", lineHeight: 1.2 }}>Finance Forum</div>
          <div style={{ fontSize: 11, color: "#8FA0AE" }}>of India · Portal</div>
        </div>
      </div>

      <div style={{ padding: "0 20px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#71828E", textTransform: "uppercase" }}>Batch</div>
          {batches.length > 1 ? (
            <select value={batchId} onChange={(e) => onChangeBatch(e.target.value)} style={pickerStyle} aria-label="Batch">
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 12.5, color: "#EDEFEA", fontWeight: 600, marginTop: 2 }}>{batchName}</div>
          )}
        </div>
        {semesters.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#71828E", textTransform: "uppercase" }}>Semester</div>
            {semesters.length > 1 ? (
              <select value={semesterId || ""} onChange={(e) => onChangeSemester(e.target.value)} style={pickerStyle} aria-label="Semester">
                {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (current)" : ""}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 12.5, color: "#EDEFEA", fontWeight: 600, marginTop: 2 }}>{semesterName}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: "6px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        {isAdmin && <GlobalBtn tab="org" icon={TrendingUp} label="Organization dashboard" />}
        {isAdmin && <GlobalBtn tab="reports" icon={FileChartColumn} label="MIS reports" />}
        <GlobalBtn tab="monthly" icon={CalendarRange} label="Monthly calendar" />
        <GlobalBtn tab="weekly-sched" icon={CalendarClock} label="Weekly schedule" />
        {isAdmin && <GlobalBtn tab="subjects" icon={GraduationCap} label="Semesters & subjects" />}
        {isAdmin && <GlobalBtn tab="payout" icon={Wallet} label="Faculty payout" />}
        {isAdmin && <GlobalBtn tab="fees" icon={Receipt} label="Student fees" />}
        {isAdmin && <GlobalBtn tab="batches" icon={Layers} label="Batches" />}
        {user.role === "student" && <GlobalBtn tab="myresults" icon={Award} label="My Results" />}
        {isAdmin && <GlobalBtn tab="credentials" icon={Settings} label="Credentials & faculty" />}
        {isAdmin && <GlobalBtn tab="audit" icon={History} label="Audit log" />}
      </div>

      <div style={{ padding: "14px 20px 6px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: "#71828E", textTransform: "uppercase" }}>
        {user.role === "faculty" ? (courses.length > 1 ? "Your subjects" : "Your subject") : "Subjects"}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
        {courses.length === 0 && <div style={{ fontSize: 12, color: "#8FA0AE", padding: "8px 12px" }}>No subjects in this semester yet.</div>}
        {courses.map((c) => {
          const active = c.id === activeCourseId && !GLOBAL_TABS.includes(activeTab);
          return (
            <button key={c.id} onClick={() => onSelectCourse(c.id)}
              style={{ width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 3, borderRadius: 8, border: "none", cursor: "pointer",
                background: active ? THEME.navySoft : "transparent", borderLeft: active ? `3px solid ${THEME.green}` : "3px solid transparent" }}>
              <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "#FFFFFF" : "#C7CFD4", lineHeight: 1.3 }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: "#8FA0AE", marginTop: 4 }}>{c.faculty_name}</div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16, borderTop: "1px solid #1F344A" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: THEME.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: THEME.navy, flexShrink: 0 }}>
            {user.name.replace(/^(Mr\.|Ms\.)\s*/, "").slice(0, 1)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#FFFFFF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
            <div style={{ fontSize: 10.5, color: "#8FA0AE" }}>{roleLabel[user.role]}</div>
          </div>
        </div>
        <button onClick={onLogout} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "8px 0", borderRadius: 8, border: "1px solid #2A3D50", background: "transparent", color: "#C7CFD4", fontSize: 12.5, cursor: "pointer" }}>
          <LogOut size={13} /> Log out
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: any) {
  return (
    <div style={{ flex: 1, minWidth: 180, padding: 18, border: `1px solid ${THEME.border}`, borderRadius: 14, background: THEME.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: accent || THEME.greenLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={accent ? "#FFFFFF" : THEME.greenDark} />
        </div>
        <div style={{ fontSize: 12, color: THEME.textMuted }}>{label}</div>
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: THEME.navy }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function OrgDashboard({ courses, batchId, semesterId, scopeName, onSelectCourse, onOpenReports }: { courses: CourseSummary[]; batchId: string; semesterId: string | null; scopeName: string; onSelectCourse: (id: string) => void; onOpenReports: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [attendanceByCourse, setAttendanceByCourse] = useState<any[]>([]);
  const [overallAvgAttendance, setOverallAvgAttendance] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const details = await Promise.all(courses.map((c) => api(`/api/courses/${c.id}`)));
      let totalModules = 0, completedModules = 0;
      const progressMap: Record<string, number> = {};
      const attData: any[] = [];
      const now = new Date();
      let allAssignments: any[] = [];
      let allTests: any[] = [];

      details.forEach((d: CourseDetail, i: number) => {
        const total = d.modules.length;
        const completed = d.modules.filter((m) => m.status === "completed").length;
        totalModules += total; completedModules += completed;
        progressMap[courses[i].id] = total ? Math.round((completed / total) * 100) : 0;

        allAssignments.push(...d.assignments.map((a) => ({ ...a, courseName: courses[i].name })));
        allTests.push(...d.tests.map((t) => ({ ...t, courseName: courses[i].name })));

        const totalSessions = d.attendanceSessions.length;
        const studentIds = Object.keys(d.attendanceRecords);
        if (totalSessions > 0 && studentIds.length > 0) {
          const pcts = studentIds.map((sid) => {
            const present = Object.values(d.attendanceRecords[sid] || {}).filter(Boolean).length;
            return (present / totalSessions) * 100;
          });
          const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
          attData.push({ name: courses[i].name.length > 18 ? courses[i].name.slice(0, 16) + "…" : courses[i].name, pct: avg });
        }
      });

      setProgress(progressMap);
      setAttendanceByCourse(attData);
      setOverallAvgAttendance(attData.length ? Math.round(attData.reduce((s, c) => s + c.pct, 0) / attData.length) : null);

      const upcoming = allAssignments.filter((a) => new Date(a.deadline) >= now).sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline));
      const upcomingTests = allTests.filter((t) => new Date(t.test_date) >= now).sort((a, b) => +new Date(a.test_date) - +new Date(b.test_date));

      setStats({
        completedModules, totalModules,
        upcomingCount: upcoming.length, nextAssignment: upcoming[0]?.title ?? null,
        testCount: upcomingTests.length, nextTestDate: upcomingTests[0]?.test_date ?? null,
      });
    })();
  }, [courses]);

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Organization dashboard</div>
          <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Live progress across all {courses.length} subjects · {scopeName}</div>
        </div>
        <button onClick={onOpenReports} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8, border: "none", background: THEME.navy, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <FileChartColumn size={15} /> Download MIS report
        </button>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
          <StatCard icon={TrendingUp} label="Overall module progress" value={`${stats.completedModules} / ${stats.totalModules}`}
            sub={`${stats.totalModules ? Math.round((stats.completedModules / stats.totalModules) * 100) : 0}% completed org-wide`} accent={THEME.green} />
          <StatCard icon={ClipboardList} label="Upcoming deadlines" value={stats.upcomingCount} sub={stats.nextAssignment ? `Next: ${stats.nextAssignment}` : "None scheduled"} />
          <StatCard icon={FileText} label="Upcoming tests" value={stats.testCount} sub={stats.nextTestDate ? `Next: ${new Date(stats.nextTestDate).toLocaleDateString("en-IN")}` : "None scheduled"} />
          <StatCard icon={ClipboardCheck} label="Average attendance" value={overallAvgAttendance !== null ? `${overallAvgAttendance}%` : "No data yet"} sub="Course lectures only — see combined below" accent={overallAvgAttendance !== null && overallAvgAttendance < 75 ? "#C23B3B" : THEME.green} />
          <StatCard icon={Users} label="Faculty" value={new Set(courses.map((c) => c.faculty_id)).size} sub={`Teaching ${courses.length} subject${courses.length === 1 ? "" : "s"}`} />
        </div>
      )}

      {attendanceByCourse.length > 0 && (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.navy, marginBottom: 12 }}>Average attendance by course</div>
          <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, padding: "16px 16px 6px", marginBottom: 28, height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceByCourse} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={THEME.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: THEME.textMuted }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10.5, fill: THEME.textMuted }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${v}%`, "Average attendance"]} contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${THEME.border}` }} />
                <Bar dataKey="pct" radius={[6, 6, 0, 0]} fill={THEME.green} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <CombinedAttendanceTable batchId={batchId} semesterId={semesterId} />

      <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.navy, marginBottom: 12 }}>Course progress</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {courses.map((c) => {
          const pct = progress[c.id] ?? 0;
          return (
            <button key={c.id} onClick={() => onSelectCourse(c.id)} style={{ textAlign: "left", padding: 16, borderRadius: 12, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: THEME.navy }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 2 }}>{c.faculty_name}{c.day_allocated ? ` · ${c.day_allocated}s` : ""}</div>
                </div>
                <ChevronRight size={16} color={THEME.textFaint} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 6, background: "#EDEBE1", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: THEME.green, borderRadius: 6 }} />
                </div>
                <div style={{ fontSize: 11.5, color: THEME.textMuted, fontWeight: 600 }}>{pct}%</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CombinedAttendanceTable({ batchId, semesterId }: { batchId: string; semesterId: string | null }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => { api(`/api/attendance-summary?batchId=${batchId}${semesterId ? `&semesterId=${semesterId}` : ""}`).then(setData); }, [batchId, semesterId]);

  if (!data) return null;

  return (
    <>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.navy, marginBottom: 6 }}>Combined attendance (courses + guest events)</div>
      <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 12 }}>
        {data.totalCourseSessions} course session{data.totalCourseSessions !== 1 ? "s" : ""} + {data.totalEvents} event{data.totalEvents !== 1 ? "s" : ""} = {data.totalDenominator} total, per student.
        {data.overallAvg !== null && <> Batch average: <strong style={{ color: THEME.navy }}>{data.overallAvg}%</strong>.</>}
      </div>
      {data.totalDenominator === 0 ? (
        <div style={{ color: THEME.textFaint, fontSize: 13, marginBottom: 28 }}>No course lecture sessions or events logged yet for this batch.</div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 28 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bg, textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Student</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Course sessions attended</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Events attended</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Overall</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "7px 12px" }}>{s.name}</td>
                  <td style={{ padding: "7px 12px", textAlign: "center" }}>{s.coursePresent} / {data.totalCourseSessions}</td>
                  <td style={{ padding: "7px 12px", textAlign: "center" }}>{s.eventPresent} / {data.totalEvents}</td>
                  <td style={{ padding: "7px 12px", textAlign: "center", fontWeight: 700, color: s.pct !== null && s.pct < 75 ? "#A32D2D" : THEME.greenDark }}>{s.pct !== null ? `${s.pct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function WeeklyCalendar({ courses, user, onSaved, onSelectCourse }: any) {
  const canEditCourse = (c: CourseSummary) => user.role === "admin" || (user.role === "faculty" && c.faculty_id === user.id);
  const draft = useDraft("weekly-schedule", onSaved);
  // Day and parity are saved together in one request per course.
  const schedOf = (c: CourseSummary) => draft.get(`sched:${c.id}`, { day: c.day_allocated, parity: c.day_parity });
  const stageSched = (c: CourseSummary, next: { day: string; parity: string | null }) => {
    const unchanged = next.day === c.day_allocated && (next.parity || null) === (c.day_parity || null);
    draft.stage(`sched:${c.id}`, next,
      (v) => api(`/api/courses/${c.id}`, { method: "PATCH", body: JSON.stringify({ dayAllocated: v.day, dayParity: v.parity }) }),
      unchanged ? next : undefined);
  };
  const shown: CourseSummary[] = courses.map((c: CourseSummary) => { const sch = schedOf(c); return { ...c, day_allocated: sch.day, day_parity: sch.parity }; });
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Weekly schedule</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Which subject runs on which day. Two subjects on the same day are marked as alternating weeks.</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${DAYS_ORDER.length}, 1fr)`, gap: 10, minWidth: 760 }}>
          {DAYS_ORDER.map((day) => {
            const dayCourses = shown.filter((c: CourseSummary) => c.day_allocated === day);
            return (
              <div key={day} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                  color: dayCourses.length ? THEME.navy : THEME.textFaint, padding: "0 2px 10px", textAlign: "center",
                  borderBottom: `2px solid ${dayCourses.length ? THEME.green : THEME.border}` }}>{day.slice(0, 3)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, minHeight: 60 }}>
                  {dayCourses.length === 0 && <div style={{ fontSize: 11, color: THEME.textFaint, textAlign: "center", padding: "10px 4px" }}>—</div>}
                  {dayCourses.map((c: CourseSummary) => (
                    <div key={c.id} style={{ padding: "10px 10px", borderRadius: 10, border: `1px solid ${draft.has(`sched:${c.id}`) ? THEME.orange : THEME.border}`, background: draft.has(`sched:${c.id}`) ? "#FFFBF4" : THEME.card }}>
                      <button onClick={() => onSelectCourse(c.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", width: "100%" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.navy, lineHeight: 1.3 }}>{c.name}</div>
                        <div style={{ fontSize: 10.5, color: THEME.textMuted, marginTop: 3 }}>{c.faculty_name.replace(/^(Mr\.|Ms\.)\s*/, "")}</div>
                        {weekParityLabel(c.day_parity) && (
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: THEME.purple, marginTop: 4, padding: "2px 6px", background: THEME.purpleLight, borderRadius: 6, display: "inline-block" }}>{weekParityLabel(c.day_parity)}</div>
                        )}
                      </button>
                      {canEditCourse(c) && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                          <select value={c.day_allocated || ""} onChange={(e) => stageSched(courses.find((x: CourseSummary) => x.id === c.id), { day: e.target.value, parity: c.day_parity })} onClick={(e) => e.stopPropagation()}
                            style={{ width: "100%", padding: "5px 6px", borderRadius: 6, border: `1px solid ${THEME.border}`, fontSize: 10.5, background: THEME.bg, color: THEME.textMuted }}>
                            {DAYS_ORDER.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select value={c.day_parity || "every"} onChange={(e) => stageSched(courses.find((x: CourseSummary) => x.id === c.id), { day: c.day_allocated || "", parity: e.target.value === "every" ? null : e.target.value })} onClick={(e) => e.stopPropagation()}
                            style={{ width: "100%", padding: "5px 6px", borderRadius: 6, border: `1px solid ${THEME.border}`, fontSize: 10.5, background: THEME.bg, color: THEME.textMuted }}>
                            <option value="every">Every week</option>
                            <option value="odd">Odd weeks only</option>
                            <option value="even">Even weeks only</option>
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {courses.some((c: CourseSummary) => canEditCourse(c)) && <SaveBar draft={draft} />}
    </div>
  );
}
function EventAttendancePanel({ eventId, students }: { eventId: string; students: StudentRow[] }) {
  const [records, setRecords] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const d = await api(`/api/calendar-events/${eventId}/attendance`);
    setRecords(d.records || {});
    setLoading(false);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const draft = useDraft(`event-attendance-${eventId}`, load);
  const isPresent = (sid: string) => draft.get(`ev:${sid}`, !!records[sid]);
  const toggle = (studentRosterId: string) => {
    const next = !isPresent(studentRosterId);
    draft.stage(`ev:${studentRosterId}`, next,
      (present) => api(`/api/calendar-events/${eventId}/attendance`, { method: "POST", body: JSON.stringify({ studentRosterId, present }) }),
      !!records[studentRosterId]);
  };

  if (loading) return <div style={{ padding: "10px 16px", fontSize: 12, color: THEME.textFaint }}>Loading attendance...</div>;

  const presentCount = students.filter((s) => isPresent(s.id)).length;

  return (
    <div style={{ padding: "12px 16px", borderTop: `1px solid ${THEME.border}`, background: THEME.bg }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.navy, marginBottom: 8 }}>
        Attendance — {presentCount} / {students.length} present
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto" }}>
        {students.map((s) => {
          const present = isPresent(s.id);
          const displayName = s.name?.trim() ? s.name : s.label;
          return (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 6px", borderRadius: 6, background: present ? THEME.greenLight : THEME.card, cursor: "pointer", outline: draft.has(`ev:${s.id}`) ? `1.5px solid ${THEME.orange}` : "none" }}>
              <input type="checkbox" checked={present} onChange={() => toggle(s.id)} style={{ width: 14, height: 14 }} />
              <span style={{ color: present ? THEME.greenDark : THEME.textMuted, fontWeight: present ? 600 : 400 }}>{displayName}</span>
            </label>
          );
        })}
      </div>
      <SaveBar draft={draft} compact />
    </div>
  );
}

function MonthlyCalendar({ courses, isAdmin, batchId, students, onChanged }: { courses: CourseSummary[]; isAdmin: boolean; batchId: string; students: StudentRow[]; onChanged: () => void }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: "", title: "", note: "" });
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const loadEvents = useCallback(() => { api("/api/calendar-events").then((d) => setEvents(d.events || [])); }, []);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    events.forEach((e) => {
      const key = new Date(e.date).toISOString().slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [events]);

  const first = startOfMonth(cursor);
  const totalDays = daysInMonth(cursor);
  const leadingBlanks = mondayIndex(first.getDay());
  const cells: (number | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  const monthLabel = cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const todayStr = new Date().toISOString().slice(0, 10);

  const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    session: { bg: "#DCEBFB", text: "#1D5A9E", label: "Planned session" },
    assignment: { bg: THEME.orangeLight, text: THEME.orange, label: "Assignment" },
    test: { bg: THEME.purpleLight, text: THEME.purple, label: "Test" },
    module: { bg: THEME.greenLight, text: THEME.greenDark, label: "Module done" },
    custom: { bg: "#F3E3F7", text: "#8E3FA0", label: "Guest lecture / event" },
  };

  const submitEvent = async () => {
    if (!form.date || !form.title) return;
    await api("/api/calendar-events", { method: "POST", body: JSON.stringify({ date: form.date, title: form.title, note: form.note, batchId }) });
    setForm({ date: "", title: "", note: "" });
    setShowForm(false);
    loadEvents(); onChanged();
  };
  const removeEvent = async (id: string) => { await api(`/api/calendar-events?id=${id}`, { method: "DELETE" }); loadEvents(); onChanged(); };

  const upcoming = events.filter((e) => e.type === "custom").sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Monthly calendar</div>
          <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Assignments, tests, completed modules, and guest lectures/events — visible to everyone.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAdmin && (
            <button onClick={() => setShowForm((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: THEME.green, color: "white", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <Plus size={14} /> Add event
            </button>
          )}
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={15} /></button>
          <div style={{ fontSize: 14, fontWeight: 600, color: THEME.navy, minWidth: 140, textAlign: "center" }}>{monthLabel}</div>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={15} /></button>
        </div>
      </div>

      {isAdmin && showForm && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20, padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <div>
            <label style={{ fontSize: 12, color: THEME.textMuted }}>Date</label><br />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: THEME.textMuted }}>Title</label><br />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Guest Lecture: Industry Trends" style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, width: 220 }} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 12, color: THEME.textMuted }}>Note (optional)</label><br />
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Speaker name, venue, etc." style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <button onClick={submitEvent} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add to calendar</button>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: THEME.navy, marginBottom: 8 }}>Weekly timetable</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${DAYS_ORDER.length}, 1fr)`, gap: 8 }}>
          {DAYS_ORDER.map((day) => {
            const dayCourses = courses.filter((c) => c.day_allocated === day);
            return (
              <div key={day} style={{ padding: "8px 8px", borderRadius: 8, background: THEME.card, border: `1px solid ${THEME.border}`, minHeight: 44 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: THEME.textFaint, textTransform: "uppercase", marginBottom: 3 }}>{day.slice(0, 3)}</div>
                {dayCourses.length === 0 ? <div style={{ fontSize: 10, color: THEME.textFaint }}>—</div> : dayCourses.map((c) => (
                  <div key={c.id} style={{ fontSize: 10, fontWeight: 600, color: "#2C5FA8", lineHeight: 1.3 }}>{c.name}{weekParityLabel(c.day_parity) ? ` (${weekParityLabel(c.day_parity)})` : ""}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 14, fontSize: 11.5, flexWrap: "wrap" }}>
        {Object.values(TYPE_STYLE).map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: s.text, display: "inline-block" }} />
            <span style={{ color: THEME.textMuted }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 24 }}>
        {DAYS_ORDER.map((d) => <div key={d} style={{ fontSize: 11, fontWeight: 700, color: THEME.textMuted, textAlign: "center", padding: "0 0 6px" }}>{d.slice(0, 3)}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvents = eventsByDate[dateStr] || [];
          const isToday = dateStr === todayStr;
          return (
            <div key={dateStr} style={{ minHeight: 78, border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 6, background: isToday ? THEME.greenLight : THEME.card }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? THEME.greenDark : THEME.textMuted, marginBottom: 4 }}>{day}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {dayEvents.slice(0, 3).map((e, idx) => (
                  <div key={idx} title={`${e.label} — ${e.courseName}`} style={{ fontSize: 9, padding: "1.5px 4px", borderRadius: 4, background: TYPE_STYLE[e.type].bg, color: TYPE_STYLE[e.type].text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{e.label}</div>
                ))}
                {dayEvents.length > 3 && <div style={{ fontSize: 9, color: THEME.textFaint }}>+{dayEvents.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy, marginBottom: 10 }}>Guest lectures & events</div>
          <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
            {upcoming.map((e, i) => {
              const expanded = expandedEventId === e.id;
              return (
                <div key={e.id} style={{ borderBottom: i < upcoming.length - 1 ? `1px solid ${THEME.border}` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: THEME.navy }}>{e.label}</div>
                      <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 2 }}>{new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}{e.courseName ? ` · ${e.courseName}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      {isAdmin && (
                        <button onClick={() => { if (confirmLeave()) setExpandedEventId(expanded ? null : e.id); }} style={{ fontSize: 11.5, background: "none", border: "none", color: THEME.greenDark, cursor: "pointer", fontWeight: 600 }}>
                          {expanded ? "Hide attendance" : "Take attendance"}
                        </button>
                      )}
                      {isAdmin && <button onClick={() => removeEvent(e.id)} style={{ fontSize: 11.5, background: "none", border: "none", color: THEME.textFaint, cursor: "pointer" }}>Remove</button>}
                    </div>
                  </div>
                  {expanded && <EventAttendancePanel eventId={e.id} students={students} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BatchesPanel({ batches, onChanged }: { batches: Batch[]; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const draft = useDraft("batches", onChanged);
  const stageRename = (b: Batch, name: string) =>
    draft.stage(`batch:${b.id}`, name, (v) => api(`/api/batches/${b.id}`, { method: "PATCH", body: JSON.stringify({ name: v }) }), b.name);
  const addBatch = async () => { if (!newName.trim()) return; await api("/api/batches", { method: "POST", body: JSON.stringify({ name: newName.trim() }) }); setNewName(""); onChanged(); };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Batches</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Rename existing batches or add a new one.</div>
      </div>
      <div key={draft.version} style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden", marginBottom: 4 }}>
        {batches.map((b, i) => (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: i < batches.length - 1 ? `1px solid ${THEME.border}` : "none" }}>
            <Layers size={16} color={THEME.textFaint} />
            <input defaultValue={draft.get(`batch:${b.id}`, b.name)} onChange={(e) => stageRename(b, e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 14, ...dirtyStyle(draft.has(`batch:${b.id}`)) }} />
          </div>
        ))}
      </div>
      <SaveBar draft={draft} />
      <div style={{ height: 20 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New batch name" style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13.5 }} />
        <button onClick={addBatch} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Add batch</button>
      </div>
    </div>
  );
}

type FacultyRow = { id: string; name: string; username: string; pay_rate: number | null; subjects: { id: string; name: string; batch_name: string; semester_name: string | null }[] };

function CredentialsPanel({ batchId, students, onStudentsChanged, onFacultyChanged }: { batchId: string; students: StudentRow[]; onStudentsChanged: () => Promise<unknown> | void; onFacultyChanged: () => Promise<unknown> | void }) {
  const [creds, setCreds] = useState<any>(null);
  const [faculty, setFaculty] = useState<FacultyRow[] | null>(null);
  const [showAddFaculty, setShowAddFaculty] = useState(false);
  const [facultyError, setFacultyError] = useState("");
  const [toDelete, setToDelete] = useState<StudentRow[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const selectedStudents = students.filter((s) => selected[s.id]);
  const allSelected = students.length > 0 && selectedStudents.length === students.length;
  const loadCreds = useCallback(() => api("/api/admin/credentials").then(setCreds), []);
  const loadFaculty = useCallback(() => api("/api/faculty").then((d) => setFaculty(d.faculty || [])), []);
  useEffect(() => { loadCreds(); loadFaculty(); }, [loadCreds, loadFaculty]);
  const draft = useDraft("credentials", async () => { await Promise.all([loadCreds(), loadFaculty(), onStudentsChanged(), onFacultyChanged()]); });
  const removeFaculty = async (f: FacultyRow) => {
    if (!window.confirm(`Delete ${f.name}'s faculty account? They will no longer be able to log in.`)) return;
    setFacultyError("");
    try { await api(`/api/faculty/${f.id}`, { method: "DELETE" }); draft.drop((k) => k.startsWith(`fac:${f.id}:`)); await loadFaculty(); }
    catch (e: any) { setFacultyError(e.message); }
  };
  const inputStyle = { padding: "6px 9px", borderRadius: 6, border: `1px solid ${THEME.border}`, fontSize: 12.5 };
  if (!creds || !faculty) return <div style={{ color: THEME.textMuted, fontSize: 13 }}>Loading credentials...</div>;

  const patchUser = (userId: string, body: object) => api("/api/admin/credentials", { method: "PATCH", body: JSON.stringify({ userId, ...body }) });
  const patchStudent = (id: string, body: object) => api(`/api/students/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  // A text field bound to the draft: shows the staged value, highlights when changed.
  const Field = ({ k, original, commit, width, placeholder, type = "text" }: { k: string; original: string; commit: (v: any) => Promise<unknown>; width: number; placeholder?: string; type?: string }) => (
    <input type={type} defaultValue={draft.get(k, original)} placeholder={placeholder}
      onChange={(e) => draft.stage(k, type === "number" ? Number(e.target.value) : e.target.value, commit, type === "number" ? Number(original) : original)}
      style={{ ...inputStyle, width, ...dirtyStyle(draft.has(k)) }} />
  );

  return (
    <div key={draft.version}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Credentials &amp; faculty</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Only visible to you. Add and manage faculty, every login, student names and pay rates here. Edits apply when you click Save.</div>
      </div>

      <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy, marginBottom: 10 }}>Your admin login</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: THEME.textMuted }}>Username: <strong>{creds.admin?.username}</strong></span>
          {Field({ k: "admin:password", original: "", width: 160, placeholder: "New password", commit: (v) => (v ? patchUser(creds.admin.id, { password: v }) : Promise.resolve()) })}
        </div>
      </div>

      <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy, marginBottom: 4 }}>Faculty <span style={{ fontWeight: 500, color: THEME.textMuted }}>· {faculty.length} member{faculty.length === 1 ? "" : "s"}</span></div>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Add a faculty member here, then assign their subjects in Semesters &amp; subjects. One person can teach several subjects.</div>
          </div>
          <button onClick={() => setShowAddFaculty((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: THEME.green, color: "white", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            <UserPlus size={14} /> Add faculty
          </button>
        </div>
        {showAddFaculty && <AddFacultyForm onCancel={() => setShowAddFaculty(false)} onAdded={async () => { await loadFaculty(); await onFacultyChanged(); }} />}
        {facultyError && <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: "#FCEBEB", color: "#A32D2D", fontSize: 12.5 }}>{facultyError}</div>}
        {faculty.length === 0 && <div style={{ fontSize: 12.5, color: THEME.textFaint, padding: "8px 0" }}>No faculty yet. Click “Add faculty”.</div>}
        {faculty.map((f) => (
          <div key={f.id} style={{ padding: "10px 0", borderBottom: `1px solid ${THEME.border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {Field({ k: `fac:${f.id}:name`, original: f.name, width: 170, placeholder: "Full name", commit: (v) => patchUser(f.id, { name: v }) })}
              {Field({ k: `fac:${f.id}:username`, original: f.username, width: 130, placeholder: "Username", commit: (v) => patchUser(f.id, { username: v }) })}
              {Field({ k: `fac:${f.id}:password`, original: "", width: 110, placeholder: "New password", commit: (v) => (v ? patchUser(f.id, { password: v }) : Promise.resolve()) })}
              <span style={{ fontSize: 11.5, color: THEME.textMuted }}>Pay rate ₹/hr:</span>
              {Field({ k: `fac:${f.id}:payRate`, original: String(Number(f.pay_rate ?? 800)), width: 70, type: "number", commit: (v) => patchUser(f.id, { payRate: v }) })}
              <button onClick={() => removeFaculty(f)} title={f.subjects.length ? "Reassign their subjects before deleting" : `Delete ${f.name}`}
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 9px", borderRadius: 6, border: "1px solid #F1C9C9", background: "#FFF5F5", color: "#A32D2D", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {f.subjects.length === 0 ? <span style={{ fontSize: 11.5, color: THEME.orange }}>No subjects assigned yet</span> : f.subjects.map((sub) => (
                <span key={sub.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: THEME.bg, border: `1px solid ${THEME.border}`, color: THEME.textMuted }}>
                  {sub.name}{sub.semester_name ? ` · ${sub.semester_name}` : ""} · {sub.batch_name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy, marginBottom: 4 }}>Student logins <span style={{ fontWeight: 500, color: THEME.textMuted }}>· {students.length} student{students.length === 1 ? "" : "s"} in this batch</span></div>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Each student has their own username and password. Deleting a student removes them and all their data from the portal.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedStudents.length > 0 && (
              <button onClick={() => setToDelete(selectedStudents)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #F1C9C9", background: "#FFF5F5", color: "#A32D2D", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                <Trash2 size={14} /> Delete selected ({selectedStudents.length})
              </button>
            )}
            <button onClick={() => setShowAdd((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: THEME.green, color: "white", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              <Plus size={14} /> Add student
            </button>
          </div>
        </div>
        {showAdd && <AddStudentForm batchId={batchId} onCancel={() => setShowAdd(false)} onAdded={async () => { await onStudentsChanged(); }} />}
        <div style={{ maxHeight: 420, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
            <thead><tr style={{ borderBottom: `1px solid ${THEME.border}`, textAlign: "left" }}>
              <th style={{ padding: "6px 8px", width: 28 }}><input type="checkbox" title="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? {} : Object.fromEntries(students.map((s) => [s.id, true])))} /></th><th style={{ padding: "6px 8px" }}>Seat</th><th style={{ padding: "6px 8px" }}>Name</th><th style={{ padding: "6px 8px" }}>Username</th><th style={{ padding: "6px 8px" }}>New password</th><th style={{ padding: "6px 8px", textAlign: "center" }}>Delete</th>
            </tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}`, background: selected[s.id] ? "#FFF8F8" : undefined }}>
                  <td style={{ padding: "5px 8px" }}><input type="checkbox" checked={!!selected[s.id]} onChange={() => setSelected((sel) => ({ ...sel, [s.id]: !sel[s.id] }))} /></td>
                  <td style={{ padding: "5px 8px", color: THEME.textFaint }}>{s.label}</td>
                  <td style={{ padding: "5px 8px" }}>{Field({ k: `stu:${s.id}:name`, original: s.name || "", width: 140, placeholder: "Enter name", commit: (v) => patchStudent(s.id, { name: v }) })}</td>
                  <td style={{ padding: "5px 8px" }}>{Field({ k: `stu:${s.id}:username`, original: s.username || "", width: 110, commit: (v) => patchStudent(s.id, { username: v }) })}</td>
                  <td style={{ padding: "5px 8px" }}>{Field({ k: `stu:${s.id}:password`, original: "", width: 110, placeholder: "New password", commit: (v) => (v ? patchStudent(s.id, { password: v }) : Promise.resolve()) })}</td>
                  <td style={{ padding: "5px 8px", textAlign: "center" }}>
                    <button onClick={() => setToDelete([s])} title={`Delete ${s.name?.trim() || s.label}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 9px", borderRadius: 6, border: "1px solid #F1C9C9", background: "#FFF5F5", color: "#A32D2D", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: THEME.textFaint }}>No students in this batch yet. Click “Add student” to add one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <SaveBar draft={draft} />

      {toDelete && (
        <DeleteStudentDialog students={toDelete} onClose={() => setToDelete(null)}
          onDeleted={async (ids) => {
            draft.drop((k) => ids.some((id) => k.startsWith(`stu:${id}:`)));
            setSelected((sel) => Object.fromEntries(Object.entries(sel).filter(([id]) => !ids.includes(id))));
            await onStudentsChanged();
          }} />
      )}
    </div>
  );
}

function AddFacultyForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => Promise<unknown> }) {
  const blank = { name: "", username: "", password: "", payRate: "800" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastAdded, setLastAdded] = useState("");
  const field = { padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const d = await api("/api/faculty", { method: "POST", body: JSON.stringify(form) });
      setLastAdded(`${d.faculty.name} added (username: ${d.faculty.username}). Assign their subjects in Semesters & subjects.`);
      setForm(blank);
      await onAdded();
    } catch (e: any) { setError(e.message || "Could not add the faculty member."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, border: `1px solid ${THEME.green}`, background: "#F8FCF2" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: THEME.navy, marginBottom: 10 }}>Add a new faculty member</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Full name</label><br /><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ms. Neha Rao" style={{ ...field, width: 180 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Username</label><br /><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, "") })} placeholder="e.g. neha.rao" style={{ ...field, width: 140 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Password</label><br /><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 4 characters" style={{ ...field, width: 150 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Pay rate ₹/hr</label><br /><input type="number" min={0} value={form.payRate} onChange={(e) => setForm({ ...form, payRate: e.target.value })} style={{ ...field, width: 90 }} /></div>
        <button onClick={submit} disabled={busy} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Adding…" : "Add faculty"}</button>
        <button onClick={onCancel} style={{ padding: "9px 14px", borderRadius: 7, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#A32D2D" }}>{error}</div>}
      {lastAdded && !error && <div style={{ marginTop: 10, fontSize: 12.5, color: THEME.greenDark, fontWeight: 600 }}>✓ {lastAdded}</div>}
    </div>
  );
}

function AddStudentForm({ batchId, onCancel, onAdded }: { batchId: string; onCancel: () => void; onAdded: () => Promise<unknown> }) {
  const blank = { name: "", username: "", password: "", feeCategory: "General" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastAdded, setLastAdded] = useState("");
  const field = { padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const d = await api("/api/students", { method: "POST", body: JSON.stringify({ batchId, ...form }) });
      setLastAdded(`${d.student.name} added as ${d.student.label} (username: ${d.student.username}).`);
      setForm(blank);
      await onAdded();
    } catch (e: any) { setError(e.message || "Could not add the student."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, border: `1px solid ${THEME.green}`, background: "#F8FCF2" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: THEME.navy, marginBottom: 10 }}>Add a new student to this batch</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Full name</label><br /><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Sharma" style={{ ...field, width: 180 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Username</label><br /><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, "") })} placeholder="e.g. priya.sharma" style={{ ...field, width: 140 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Password</label><br /><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 4 characters" style={{ ...field, width: 150 }} /></div>
        <div><label style={{ fontSize: 11.5, color: THEME.textMuted }}>Fee category</label><br />
          <select value={form.feeCategory} onChange={(e) => setForm({ ...form, feeCategory: e.target.value })} style={field}><option value="General">General</option><option value="Reserved">Reserved</option></select>
        </div>
        <button onClick={submit} disabled={busy} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Adding…" : "Add student"}</button>
        <button onClick={onCancel} style={{ padding: "9px 14px", borderRadius: 7, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#A32D2D" }}>{error}</div>}
      {lastAdded && !error && <div style={{ marginTop: 10, fontSize: 12.5, color: THEME.greenDark, fontWeight: 600 }}>✓ {lastAdded} You can add another.</div>}
    </div>
  );
}

function DeleteStudentDialog({ students, onClose, onDeleted }: { students: StudentRow[]; onClose: () => void; onDeleted: (ids: string[]) => Promise<unknown> | void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const nameOf = (s: StudentRow) => (s.name?.trim() ? `${s.name} (${s.label})` : s.label);
  const single = students.length === 1;
  const confirmed = typed.trim().toUpperCase() === "DELETE";

  const doDelete = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setError("");
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const s of students) {
      try { await api(`/api/students/${s.id}`, { method: "DELETE" }); deleted.push(s.id); }
      catch { failed.push(nameOf(s)); }
      setProgress(deleted.length + failed.length);
    }
    await onDeleted(deleted);
    if (failed.length) { setError(`Could not delete: ${failed.join(", ")}. Please try again.`); setBusy(false); }
    else onClose();
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,29,46,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: THEME.card, borderRadius: 14, padding: 22, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FCEBEB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><TriangleAlert size={18} color="#A32D2D" /></div>
          <div style={{ fontSize: 16, fontWeight: 700, color: THEME.navy }}>{single ? `Delete ${nameOf(students[0])}?` : `Delete ${students.length} students?`}</div>
        </div>
        {!single && (
          <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 12, color: THEME.textMuted, background: THEME.bg, borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
            {students.map(nameOf).join(", ")}
          </div>
        )}
        <div style={{ fontSize: 13, color: THEME.navy, lineHeight: 1.55 }}>
          This permanently removes {single ? "the student" : "these students"} from the portal, including:
          <div style={{ margin: "8px 0 10px", color: THEME.textMuted }}>login, attendance in every subject and guest event, all marks (formative and summative), and fee payment records.</div>
          <strong>This cannot be undone.</strong> Type <strong>DELETE</strong> to confirm.
        </div>
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doDelete(); }} placeholder="Type DELETE" disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: "9px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13.5 }} />
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#A32D2D" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={doDelete} disabled={!confirmed || busy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700,
              background: confirmed ? "#C23B3B" : "#E8C4C4", color: "white", cursor: confirmed && !busy ? "pointer" : "default" }}>
            <Trash2 size={14} /> {busy ? `Deleting ${progress} of ${students.length}…` : single ? "Delete student" : `Delete ${students.length} students`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SEMESTERS & SUBJECTS (admin)
// Add semesters to a batch, add/edit/delete the subjects in each semester,
// and edit every subject's modules and internal-assessment pattern.
// ─────────────────────────────────────────────────────────────
type PatternRow = { id?: string; name: string; maxMarks: number | string };
type ModuleDraftRow = { id?: string; name: string; status?: string };

const PATTERN_PRESETS: { key: string; label: string; rows: PatternRow[] }[] = [
  { key: "project", label: "Micro Project · Viva · Attendance & Attitude · Presentation & Viva", rows: [
    { name: "Micro Project", maxMarks: 10 }, { name: "Viva (Micro Project)", maxMarks: 10 },
    { name: "Attendance & Attitude", maxMarks: 10 }, { name: "Presentation & Viva", maxMarks: 20 }] },
  { key: "tests", label: "Test 1–4 · Attendance", rows: [
    { name: "Test 1", maxMarks: 10 }, { name: "Test 2", maxMarks: 10 }, { name: "Test 3", maxMarks: 10 },
    { name: "Test 4", maxMarks: 10 }, { name: "Attendance", maxMarks: 10 }] },
];

const smallBtn = (tone: "plain" | "green" | "navy" | "red" = "plain") => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  border: tone === "plain" ? `1px solid ${THEME.border}` : tone === "red" ? "1px solid #F1C9C9" : "none",
  background: tone === "green" ? THEME.green : tone === "navy" ? THEME.navy : tone === "red" ? "#FFF5F5" : THEME.card,
  color: tone === "green" || tone === "navy" ? "white" : tone === "red" ? "#A32D2D" : THEME.navy,
} as const);
const inputBox = { padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, background: THEME.card, boxSizing: "border-box" as const };
const labelStyle = { fontSize: 11.5, color: THEME.textMuted, display: "block", marginBottom: 4 } as const;

function SubjectsPanel({ batchId, batchName, semesters, courses, selectedSemesterId, onSelectSemester, onChanged, onOpenCourse, onOpenCredentials }: {
  batchId: string; batchName: string; semesters: Semester[]; courses: CourseSummary[]; selectedSemesterId: string | null;
  onSelectSemester: (id: string) => void; onChanged: () => Promise<unknown>; onOpenCourse: (id: string) => void; onOpenCredentials: () => void;
}) {
  const [faculty, setFaculty] = useState<FacultyRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // a subject id, "new", or null
  const [showAddSem, setShowAddSem] = useState(false);
  const [newSem, setNewSem] = useState({ name: "", copyFrom: "" });
  const [semName, setSemName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState<CourseSummary | null>(null);

  useEffect(() => { api("/api/faculty").then((d) => setFaculty(d.faculty || [])); }, []);
  const semId = semesters.some((s) => s.id === selectedSemesterId) ? selectedSemesterId! : semesters[0]?.id;
  const sem = semesters.find((s) => s.id === semId);
  useEffect(() => { setSemName(sem?.name || ""); setEditing(null); setError(""); }, [sem?.id, sem?.name]);

  const semSubjects = courses.filter((c) => semesterOf(c, semesters) === semId).sort((a, b) => a.name.localeCompare(b.name));
  const nextNumber = (semesters.reduce((m, s) => Math.max(m, s.semester_number), 0) || 0) + 1;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); await onChanged(); } catch (e: any) { setError(e.message || "Something went wrong."); }
    finally { setBusy(false); }
  };
  const addSemester = () => run(async () => {
    const d = await api("/api/semesters", { method: "POST", body: JSON.stringify({ batchId, name: newSem.name.trim() || undefined, copyFromSemesterId: newSem.copyFrom || undefined }) });
    setShowAddSem(false); setNewSem({ name: "", copyFrom: "" });
    await onChanged();
    onSelectSemester(d.semester.id);
  });
  const renameSemester = () => run(() => api(`/api/semesters/${semId}`, { method: "PATCH", body: JSON.stringify({ name: semName }) }));
  const makeCurrent = () => run(() => api(`/api/semesters/${semId}`, { method: "PATCH", body: JSON.stringify({ isCurrent: true }) }));
  const deleteSemester = () => {
    if (!sem || !window.confirm(`Delete ${sem.name}? It has no subjects, so nothing else is removed.`)) return;
    run(async () => { await api(`/api/semesters/${semId}`, { method: "DELETE" }); const other = semesters.find((s) => s.id !== semId); if (other) onSelectSemester(other.id); });
  };

  if (!faculty) return <div style={{ color: THEME.textMuted, fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Semesters &amp; subjects</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>
          {batchName}. Add a semester, then add its subjects. For each subject you can set the faculty, timetable, modules and internal marks pattern.
        </div>
      </div>

      {/* Semester tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {semesters.map((s) => {
          const active = s.id === semId;
          return (
            <button key={s.id} onClick={() => onSelectSemester(s.id)} style={{ padding: "9px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left",
              border: `1.5px solid ${active ? THEME.green : THEME.border}`, background: active ? THEME.greenLight : THEME.card }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy, display: "flex", alignItems: "center", gap: 6 }}>
                {s.name}{s.is_current && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: THEME.green, color: "white" }}>CURRENT</span>}
              </div>
              <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 2 }}>{s.subject_count} subject{s.subject_count === 1 ? "" : "s"}</div>
            </button>
          );
        })}
        <button onClick={() => setShowAddSem((v) => !v)} style={{ ...smallBtn("plain"), padding: "12px 14px", borderStyle: "dashed", borderRadius: 10 }}>
          <Plus size={14} /> Add semester
        </button>
      </div>

      {showAddSem && (
        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.green}`, background: "#F8FCF2", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: THEME.navy, marginBottom: 10 }}>Add a new semester to {batchName}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={labelStyle}>Name</label><input value={newSem.name} onChange={(e) => setNewSem({ ...newSem, name: e.target.value })} placeholder={`Semester ${nextNumber}`} style={{ ...inputBox, width: 180 }} /></div>
            <div>
              <label style={labelStyle}>Start with</label>
              <select value={newSem.copyFrom} onChange={(e) => setNewSem({ ...newSem, copyFrom: e.target.value })} style={{ ...inputBox, minWidth: 260 }}>
                <option value="">No subjects (I'll add them)</option>
                {semesters.filter((s) => s.subject_count > 0).map((s) => <option key={s.id} value={s.id}>A copy of {s.name}'s subjects ({s.subject_count})</option>)}
              </select>
            </div>
            <button onClick={addSemester} disabled={busy} style={smallBtn("green")}>{busy ? "Adding…" : "Add semester"}</button>
            <button onClick={() => setShowAddSem(false)} style={smallBtn("plain")}>Cancel</button>
          </div>
          {newSem.copyFrom && <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 8 }}>The copy keeps subject names, faculty, timetable, modules and internal pattern — with no attendance, marks or progress. You can then edit or delete each one.</div>}
        </div>
      )}

      {error && <div style={{ marginBottom: 14, padding: "9px 12px", borderRadius: 8, background: "#FCEBEB", color: "#A32D2D", fontSize: 12.5 }}>{error}</div>}

      {sem && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: 12, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 16 }}>
          <input value={semName} onChange={(e) => setSemName(e.target.value)} style={{ ...inputBox, width: 200, ...dirtyStyle(semName !== sem.name) }} aria-label="Semester name" />
          {semName.trim() && semName !== sem.name && <button onClick={renameSemester} disabled={busy} style={smallBtn("green")}><Save size={13} /> Save name</button>}
          <div style={{ flex: 1 }} />
          {sem.is_current
            ? <span style={{ fontSize: 12, color: THEME.greenDark, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><Star size={13} /> Current semester — students and faculty open this one by default</span>
            : <button onClick={makeCurrent} disabled={busy} style={smallBtn("navy")}><Star size={13} /> Make this the current semester</button>}
          {semesters.length > 1 && semSubjects.length === 0 && <button onClick={deleteSemester} disabled={busy} style={smallBtn("red")}><Trash2 size={13} /> Delete semester</button>}
        </div>
      )}

      {faculty.length === 0 && (
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: THEME.orangeLight, color: THEME.orange, fontSize: 12.5 }}>
          Add at least one faculty member first — every subject needs one. <button onClick={onOpenCredentials} style={{ background: "none", border: "none", color: THEME.navy, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>Go to Credentials &amp; faculty</button>
        </div>
      )}

      {/* Subjects in this semester */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: THEME.navy }}>Subjects in {sem?.name}</div>
        {editing !== "new" && faculty.length > 0 && <button onClick={() => { if (confirmLeave()) setEditing("new"); }} style={smallBtn("green")}><Plus size={14} /> Add subject</button>}
      </div>

      {editing === "new" && sem && (
        <SubjectForm key="new" batchId={batchId} semesters={semesters} semesterId={sem.id} faculty={faculty} allCourses={courses}
          onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged(); }} onOpenCredentials={onOpenCredentials} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {semSubjects.length === 0 && editing !== "new" && <div style={{ padding: 20, border: `1px dashed ${THEME.border}`, borderRadius: 12, textAlign: "center", fontSize: 13, color: THEME.textFaint }}>No subjects in this semester yet.</div>}
        {semSubjects.map((c) => editing === c.id ? (
          <SubjectForm key={c.id} course={c} batchId={batchId} semesters={semesters} semesterId={semId!} faculty={faculty} allCourses={courses}
            onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged(); }} onOpenCredentials={onOpenCredentials} />
        ) : (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: THEME.navy }}>{c.name} <span style={{ fontSize: 11, fontWeight: 600, color: THEME.textFaint }}>{c.code}</span></div>
              <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 3 }}>
                {[c.faculty_name, c.day_allocated ? `${c.day_allocated}s${weekParityLabel(c.day_parity) ? ` (${weekParityLabel(c.day_parity)})` : ""}` : "No day set", c.total_hours ? `${c.total_hours} hours` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={() => onOpenCourse(c.id)} style={smallBtn("plain")}>Open</button>
            <button onClick={() => { if (confirmLeave()) setEditing(c.id); }} style={smallBtn("plain")}><Pencil size={13} /> Edit setup</button>
            <button onClick={() => setToDelete(c)} style={smallBtn("red")}><Trash2 size={13} /> Delete</button>
          </div>
        ))}
      </div>

      {toDelete && (
        <TypeToConfirmDialog
          title={`Delete ${toDelete.name}?`}
          body={<>This permanently removes the subject and everything recorded under it: modules and progress, weekly plans, assignments, tests, attendance and all marks. Faculty payout entries are kept.</>}
          actionLabel="Delete subject"
          onClose={() => setToDelete(null)}
          onConfirm={async () => { await api(`/api/courses/${toDelete.id}`, { method: "DELETE" }); await onChanged(); }}
        />
      )}
    </div>
  );
}

function SubjectForm({ course, batchId, semesters, semesterId, faculty, allCourses, onCancel, onSaved, onOpenCredentials }: {
  course?: CourseSummary; batchId: string; semesters: Semester[]; semesterId: string; faculty: FacultyRow[]; allCourses: CourseSummary[];
  onCancel: () => void; onSaved: () => Promise<unknown>; onOpenCredentials: () => void;
}) {
  const isNew = !course;
  type FormState = {
    name: string; code: string; facultyId: string; semesterId: string; day: string; parity: string; totalHours: string; externalMax: string;
    modules: ModuleDraftRow[]; components: PatternRow[];
  };
  const [form, setForm] = useState<FormState | null>(null);
  const [original, setOriginal] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      let f: FormState;
      if (course) {
        const d: CourseDetail = await api(`/api/courses/${course.id}`);
        f = {
          name: d.course.name, code: d.course.code || "", facultyId: d.course.faculty_id, semesterId: semesterId,
          day: d.course.day_allocated || "", parity: d.course.day_parity || "", totalHours: d.course.total_hours == null ? "" : String(d.course.total_hours),
          externalMax: String(d.course.external_max_marks ?? 50),
          modules: d.modules.map((m) => ({ id: m.id, name: m.module_name || "", status: m.status })),
          components: d.components.map((c) => ({ id: c.id, name: c.component_name, maxMarks: c.max_marks })),
        };
      } else {
        f = {
          name: "", code: "", facultyId: "", semesterId, day: "", parity: "", totalHours: "", externalMax: "50",
          modules: Array.from({ length: 5 }, () => ({ name: "" })),
          components: PATTERN_PRESETS[0].rows.map((r) => ({ ...r })),
        };
      }
      setForm(f); setOriginal(JSON.parse(JSON.stringify(f)));
    })().catch((e) => setError(e.message));
  }, [course, semesterId, faculty]);

  const dirty = !!form && !!original && JSON.stringify(form) !== JSON.stringify(original);
  const panelId = `subject-form-${course?.id || "new"}`;
  useEffect(() => {
    if (dirty) dirtyPanels.add(panelId); else dirtyPanels.delete(panelId);
    return () => { dirtyPanels.delete(panelId); };
  }, [dirty, panelId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!form) return <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, fontSize: 13, color: THEME.textMuted }}>{error || "Loading subject…"}</div>;

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const move = <T,>(list: T[], i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= list.length) return list; const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next; };
  const internalTotal = form.components.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0);
  const ext = Number(form.externalMax) || 0;

  const loadPattern = async (value: string) => {
    if (!value) return;
    let rows: PatternRow[] = [];
    const preset = PATTERN_PRESETS.find((p) => `preset:${p.key}` === value);
    if (preset) rows = preset.rows.map((r) => ({ ...r }));
    else if (value.startsWith("copy:")) {
      const d: CourseDetail = await api(`/api/courses/${value.slice(5)}`);
      rows = d.components.map((c) => ({ name: c.component_name, maxMarks: c.max_marks }));
    }
    if (form.components.length && !window.confirm("Replace the current internal pattern with this one?")) return;
    set({ components: rows });
  };

  const save = async () => {
    setError("");
    if (!form.name.trim()) { setError("Please enter the subject name."); return; }
    if (!form.facultyId) { setError("Please choose the faculty member."); return; }
    if (form.components.some((c) => !String(c.name).trim())) { setError("Every internal component needs a name."); return; }
    if (form.components.some((c) => !(Number(c.maxMarks) > 0) || !Number.isInteger(Number(c.maxMarks)))) { setError("Every internal component needs whole-number marks above 0."); return; }
    if (original && !isNew) {
      const keptC = new Set(form.components.map((c) => c.id).filter(Boolean));
      const removedC = original.components.filter((c) => c.id && !keptC.has(c.id));
      const keptM = new Set(form.modules.map((m) => m.id).filter(Boolean));
      const removedM = original.modules.filter((m) => m.id && !keptM.has(m.id));
      const lowered = form.components.filter((c) => { const o = original.components.find((x) => x.id && x.id === c.id); return o && Number(c.maxMarks) < Number(o.maxMarks); });
      const warnings: string[] = [];
      if (removedC.length) warnings.push(`Removing ${removedC.map((c) => `"${c.name}"`).join(", ")} deletes any marks already entered for ${removedC.length > 1 ? "them" : "it"}.`);
      if (lowered.length) warnings.push(`Lowering the maximum for ${lowered.map((c) => `"${c.name}"`).join(", ")} caps marks already entered above the new maximum.`);
      if (Number(form.externalMax) < Number(original.externalMax)) warnings.push(`Lowering external marks caps any external marks already entered above ${form.externalMax}.`);
      if (removedM.length) warnings.push(`Removing ${removedM.length} module${removedM.length > 1 ? "s" : ""} also removes ${removedM.length > 1 ? "their" : "its"} progress status.`);
      if (warnings.length && !window.confirm(`${warnings.join("\n\n")}\n\nSave anyway?`)) return;
    }
    const payload = {
      name: form.name.trim(), code: form.code.trim(), facultyId: form.facultyId, semesterId: form.semesterId,
      dayAllocated: form.day || null, dayParity: form.day ? (form.parity || null) : null,
      totalHours: form.totalHours === "" ? null : Number(form.totalHours), externalMaxMarks: Number(form.externalMax) || 0,
      modules: form.modules.map((m) => ({ id: m.id, name: m.name })),
      components: form.components.map((c) => ({ id: c.id, name: String(c.name).trim(), maxMarks: Number(c.maxMarks) })),
    };
    setSaving(true);
    try {
      if (isNew) await api("/api/courses", { method: "POST", body: JSON.stringify(payload) });
      else await api(`/api/courses/${course!.id}`, { method: "PUT", body: JSON.stringify(payload) });
      dirtyPanels.delete(panelId);
      await onSaved();
    } catch (e: any) { setError(e.message || "Could not save."); setSaving(false); }
  };

  const otherSubjects = allCourses.filter((c) => c.id !== course?.id);
  const iconBtn = { width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer", color: THEME.textMuted, flexShrink: 0 } as const;
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: THEME.navy, margin: "18px 0 8px" } as const;

  return (
    <div style={{ padding: 18, border: `1.5px solid ${dirty ? THEME.orange : THEME.green}`, borderRadius: 14, background: THEME.card, marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: THEME.navy, marginBottom: 14 }}>{isNew ? "Add a subject" : `Edit ${course!.name}`}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        <div style={{ gridColumn: "span 2" }}><label style={labelStyle}>Subject name *</label><input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Financial Accounting" style={{ ...inputBox, width: "100%" }} /></div>
        <div><label style={labelStyle}>Subject code</label><input value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="Auto if left blank" style={{ ...inputBox, width: "100%" }} /></div>
        <div>
          <label style={labelStyle}>Faculty *</label>
          <select value={form.facultyId} onChange={(e) => set({ facultyId: e.target.value })} style={{ ...inputBox, width: "100%" }}>
            {!form.facultyId && <option value="">Choose faculty…</option>}
            {faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button onClick={onOpenCredentials} style={{ background: "none", border: "none", padding: 0, marginTop: 4, fontSize: 11, color: THEME.greenDark, cursor: "pointer" }}>+ Add a new faculty member</button>
        </div>
        <div>
          <label style={labelStyle}>Semester</label>
          <select value={form.semesterId} onChange={(e) => set({ semesterId: e.target.value })} style={{ ...inputBox, width: "100%" }}>
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Day</label>
          <select value={form.day} onChange={(e) => set({ day: e.target.value })} style={{ ...inputBox, width: "100%" }}>
            <option value="">Not set</option>
            {DAYS_ORDER.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Weeks</label>
          <select value={form.parity} onChange={(e) => set({ parity: e.target.value })} disabled={!form.day} style={{ ...inputBox, width: "100%" }}>
            <option value="">Every week</option><option value="odd">Odd weeks only</option><option value="even">Even weeks only</option>
          </select>
        </div>
        <div><label style={labelStyle}>Total hours</label><input type="number" min={0} value={form.totalHours} onChange={(e) => set({ totalHours: e.target.value })} style={{ ...inputBox, width: "100%" }} /></div>
      </div>

      {/* Modules */}
      <div style={sectionTitle}>Modules <span style={{ fontWeight: 500, color: THEME.textMuted }}>· {form.modules.length}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {form.modules.map((m, i) => (
          <div key={m.id || `new-${i}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ width: 26, textAlign: "center", fontSize: 12, fontWeight: 700, color: THEME.textMuted, flexShrink: 0 }}>{i + 1}</div>
            <input value={m.name} placeholder="Module name (can be added later)" onChange={(e) => set({ modules: form.modules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ ...inputBox, flex: 1, minWidth: 0 }} />
            {m.status && m.status !== "not_started" && <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: STATUS_STYLES[m.status].bg, color: STATUS_STYLES[m.status].text, flexShrink: 0 }}>{STATUS_STYLES[m.status].label}</span>}
            <button title="Move up" onClick={() => set({ modules: move(form.modules, i, -1) })} style={iconBtn}><ArrowUp size={13} /></button>
            <button title="Move down" onClick={() => set({ modules: move(form.modules, i, 1) })} style={iconBtn}><ArrowDown size={13} /></button>
            <button title="Remove module" onClick={() => set({ modules: form.modules.filter((_, j) => j !== i) })} style={{ ...iconBtn, color: "#A32D2D" }}><X size={13} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => set({ modules: [...form.modules, { name: "" }] })} style={{ ...smallBtn("plain"), marginTop: 8 }}><Plus size={13} /> Add module</button>

      {/* Internal pattern */}
      <div style={{ ...sectionTitle, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>Internal marks pattern</span>
        <select value="" onChange={(e) => loadPattern(e.target.value)} style={{ ...inputBox, fontSize: 12, padding: "6px 8px", fontWeight: 500 }}>
          <option value="">Start from a pattern…</option>
          <optgroup label="Standard patterns">
            {PATTERN_PRESETS.map((p) => <option key={p.key} value={`preset:${p.key}`}>{p.label}</option>)}
          </optgroup>
          {otherSubjects.length > 0 && (
            <optgroup label="Copy from a subject">
              {otherSubjects.map((c) => <option key={c.id} value={`copy:${c.id}`}>{c.name}{semesters.find((s) => s.id === semesterOf(c, semesters)) ? ` (${semesters.find((s) => s.id === semesterOf(c, semesters))!.name})` : ""}</option>)}
            </optgroup>
          )}
        </select>
      </div>
      <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, overflow: "hidden" }}>
        {form.components.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: THEME.textFaint }}>No internal components. Add one below or start from a pattern.</div>}
        {form.components.map((c, i) => (
          <div key={c.id || `new-${i}`} style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${THEME.border}` }}>
            <input value={c.name} placeholder="Component name, e.g. Test 1" onChange={(e) => set({ components: form.components.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ ...inputBox, flex: 1, minWidth: 0 }} />
            {isAttendanceComponent(String(c.name)) && <span title="Filled automatically from the Attendance tab" style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: THEME.greenLight, color: THEME.greenDark, flexShrink: 0 }}>AUTO</span>}
            <input type="number" min={1} value={c.maxMarks} onChange={(e) => set({ components: form.components.map((x, j) => (j === i ? { ...x, maxMarks: e.target.value } : x)) })} style={{ ...inputBox, width: 72, textAlign: "center" }} aria-label="Maximum marks" />
            <span style={{ fontSize: 11.5, color: THEME.textMuted, flexShrink: 0 }}>marks</span>
            <button title="Move up" onClick={() => set({ components: move(form.components, i, -1) })} style={iconBtn}><ArrowUp size={13} /></button>
            <button title="Move down" onClick={() => set({ components: move(form.components, i, 1) })} style={iconBtn}><ArrowDown size={13} /></button>
            <button title="Remove component" onClick={() => set({ components: form.components.filter((_, j) => j !== i) })} style={{ ...iconBtn, color: "#A32D2D" }}><X size={13} /></button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", background: THEME.bg, flexWrap: "wrap" }}>
          <button onClick={() => set({ components: [...form.components, { name: "", maxMarks: 10 }] })} style={smallBtn("plain")}><Plus size={13} /> Add component</button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
            <span style={{ color: THEME.greenDark, fontWeight: 700 }}>Internal: {internalTotal}</span>
            <span style={{ color: THEME.textFaint }}>+</span>
            <span style={{ color: THEME.purple, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>External:
              <input type="number" min={0} value={form.externalMax} onChange={(e) => set({ externalMax: e.target.value })} style={{ ...inputBox, width: 64, padding: "5px 6px", textAlign: "center" }} aria-label="External marks" />
            </span>
            <span style={{ color: THEME.textFaint }}>=</span>
            <span style={{ color: THEME.navy, fontWeight: 800 }}>Total {internalTotal + ext}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: THEME.textFaint, marginTop: 6 }}>A component with “attendance” in its name is filled in automatically from the Attendance tab.</div>

      {error && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "#FCEBEB", color: "#A32D2D", fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 16 }}>
        {dirty && <span style={{ fontSize: 12.5, color: THEME.orange, fontWeight: 600, marginRight: "auto" }}>Unsaved changes</span>}
        <button onClick={() => { if (!dirty || window.confirm("Discard your changes to this subject?")) { dirtyPanels.delete(panelId); onCancel(); } }} disabled={saving} style={smallBtn("plain")}>Cancel</button>
        <button onClick={save} disabled={saving || (!dirty && !isNew)} style={{ ...smallBtn("green"), padding: "8px 18px", opacity: saving || (!dirty && !isNew) ? 0.6 : 1 }}>
          <Save size={14} /> {saving ? "Saving…" : isNew ? "Add subject" : "Save"}
        </button>
      </div>
    </div>
  );
}

function TypeToConfirmDialog({ title, body, actionLabel, onClose, onConfirm }: { title: string; body: ReactNode; actionLabel: string; onClose: () => void; onConfirm: () => Promise<unknown> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = typed.trim().toUpperCase() === "DELETE";
  const go = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setError("");
    try { await onConfirm(); onClose(); } catch (e: any) { setError(e.message || "Could not delete."); setBusy(false); }
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,29,46,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: THEME.card, borderRadius: 14, padding: 22, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FCEBEB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><TriangleAlert size={18} color="#A32D2D" /></div>
          <div style={{ fontSize: 16, fontWeight: 700, color: THEME.navy }}>{title}</div>
        </div>
        <div style={{ fontSize: 13, color: THEME.navy, lineHeight: 1.55 }}>{body} <strong>This cannot be undone.</strong> Type <strong>DELETE</strong> to confirm.</div>
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} placeholder="Type DELETE" disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: "9px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13.5 }} />
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#A32D2D" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={go} disabled={!confirmed || busy} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, background: confirmed ? "#C23B3B" : "#E8C4C4", color: "white", cursor: confirmed && !busy ? "pointer" : "default" }}>
            <Trash2 size={14} /> {busy ? "Deleting…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { api("/api/notifications").then((d) => setItems(d.items || [])); }, []);

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Bell size={17} color={THEME.navy} />
        {items.length > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: "#C23B3B", color: "white", fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 17, height: 17, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{items.length}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 46, width: 320, maxHeight: 380, overflowY: "auto", background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.15)", zIndex: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${THEME.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: THEME.navy }}>Notifications</div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.textFaint }}><X size={15} /></button>
          </div>
          {items.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: THEME.textFaint }}>No assignments, tests, or events in the next 7 days.</div> : items.map((i) => {
            const badgeStyle = i.type === "test" ? { bg: THEME.purpleLight, text: THEME.purple, label: "Test" } : i.type === "event" ? { bg: THEME.greenLight, text: THEME.greenDark, label: "Event" } : { bg: THEME.orangeLight, text: THEME.orange, label: "Assignment" };
            return (
              <div key={i.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${THEME.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: THEME.navy }}>{i.label}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: badgeStyle.bg, color: badgeStyle.text, flexShrink: 0 }}>{badgeStyle.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: THEME.textMuted, marginTop: 2 }}>{i.courseName}</div>
                <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600, color: i.overdue ? "#A32D2D" : THEME.greenDark }}>{i.overdue ? "Overdue — " : ""}{new Date(i.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function Overview({ detail }: { detail: CourseDetail }) {
  const completed = detail.modules.filter((m) => m.status === "completed").length;
  const inProgress = detail.modules.filter((m) => m.status === "in_progress").length;
  const upcoming = [...detail.assignments].filter((a) => new Date(a.deadline) >= new Date()).sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline))[0];
  const nextTest = [...detail.tests].filter((t) => new Date(t.test_date) >= new Date()).sort((a, b) => +new Date(a.test_date) - +new Date(b.test_date))[0];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard icon={CheckCircle2} label="Module progress" value={`${completed} / ${detail.modules.length}`} sub={`${inProgress} in progress`} accent={THEME.green} />
        <StatCard icon={ClipboardList} label="Next assignment" value={upcoming ? upcoming.title : "None"} sub={upcoming ? `Submission date ${new Date(upcoming.deadline).toLocaleDateString("en-IN")}` : "Nothing scheduled"} />
        <StatCard icon={Clock} label="Next test" value={nextTest ? (nextTest.test_type === "surprise" ? "Surprise" : "Internal") : "None"} sub={nextTest ? new Date(nextTest.test_date).toLocaleDateString("en-IN") : "Nothing scheduled"} />
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.navy, marginBottom: 10 }}>Formative assessment components ({formativeMax(detail)} marks total)</div>
      <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, overflow: "hidden", background: THEME.card }}>
        {detail.components.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${THEME.border}` }}>
            <span style={{ fontSize: 13.5 }}>{c.component_name}{isAttendanceComponent(c.component_name) ? " (auto, from Attendance tab)" : ""}</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: THEME.greenDark }}>{c.max_marks} marks</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: THEME.bg }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>External / Summative marks</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: THEME.purple }}>{externalMax(detail.course)} marks</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: THEME.navy }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "white" }}>Total</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: THEME.green }}>{formativeMax(detail) + externalMax(detail.course)} marks</span>
        </div>
      </div>
    </div>
  );
}

function Modules({ detail, courseId, onRefresh }: { detail: CourseDetail; courseId: string; onRefresh: () => unknown }) {
  const canEdit = detail.canEdit;
  const draft = useDraft(`modules-${courseId}`, onRefresh);
  const patch = (moduleId: string, body: any) => api(`/api/courses/${courseId}/modules`, { method: "PATCH", body: JSON.stringify({ moduleId, ...body }) });
  return (
    <div key={draft.version}>
    <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
      {detail.modules.map((m) => {
        const status = draft.get(`mod:${m.id}:status`, m.status);
        const s = STATUS_STYLES[status];
        return (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${THEME.border}` }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: THEME.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: THEME.textMuted, flexShrink: 0 }}>{m.module_number}</div>
            <div style={{ flex: 1 }}>
              {canEdit ? (
                <input defaultValue={draft.get(`mod:${m.id}:name`, m.module_name || "")} placeholder="Enter module name" onChange={(e) => draft.stage(`mod:${m.id}:name`, e.target.value, (v) => patch(m.id, { moduleName: v }), m.module_name || "")} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 14, boxSizing: "border-box", ...dirtyStyle(draft.has(`mod:${m.id}:name`)) }} />
              ) : (<div style={{ fontSize: 14 }}>{m.module_name || <span style={{ color: THEME.textFaint }}>Module name not yet added</span>}</div>)}
              {m.status === "completed" && m.completed_date && <div style={{ fontSize: 11, color: THEME.textFaint, marginTop: 3 }}>Completed {new Date(m.completed_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>}
            </div>
            {canEdit ? (
              <select value={status} onChange={(e) => draft.stage(`mod:${m.id}:status`, e.target.value, (v) => patch(m.id, { status: v }), m.status)} style={{ padding: "7px 10px", borderRadius: 7, border: draft.has(`mod:${m.id}:status`) ? `1.5px solid ${THEME.orange}` : "1.5px solid transparent", fontSize: 12.5, fontWeight: 600, background: s.bg, color: s.text }}>
                <option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
              </select>
            ) : (<span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: s.bg, color: s.text }}>{s.label}</span>)}
          </div>
        );
      })}
    </div>
    {canEdit && <SaveBar draft={draft} />}
    </div>
  );
}

function WeeklyPlan({ detail, courseId, onRefresh }: { detail: CourseDetail; courseId: string; onRefresh: () => void }) {
  const blank = { weekStart: "", sessionType: "module", moduleId: "", activityName: "", topics: "" };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(blank);
  const canEdit = detail.canEdit;
  const fieldStyle = { padding: "7px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 };

  const add = async () => {
    if (!form.weekStart || !form.topics) return;
    if (form.sessionType === "activity" && !form.activityName) return;
    await api(`/api/courses/${courseId}/weekly-plans`, { method: "POST", body: JSON.stringify({ weekStartDate: form.weekStart, topics: form.topics, moduleId: form.moduleId || null, sessionType: form.sessionType, activityName: form.activityName }) });
    setForm(blank); onRefresh();
  };
  const startEdit = (w: WeeklyPlanRow) => { setEditingId(w.id); setEditForm({ weekStart: w.week_start_date.slice(0, 10), sessionType: w.session_type, moduleId: w.module_id || "", activityName: w.activity_name || "", topics: w.topics }); };
  const saveEdit = async (id: string) => {
    await api(`/api/courses/${courseId}/weekly-plans/${id}`, { method: "PATCH", body: JSON.stringify({ weekStartDate: editForm.weekStart, topics: editForm.topics, moduleId: editForm.moduleId || null, sessionType: editForm.sessionType, activityName: editForm.activityName }) });
    setEditingId(null); onRefresh();
  };
  const remove = async (id: string) => { await api(`/api/courses/${courseId}/weekly-plans/${id}`, { method: "DELETE" }); onRefresh(); };
  const sorted = [...detail.weeklyPlans].sort((a, b) => +new Date(a.week_start_date) - +new Date(b.week_start_date));

  const SessionTypeToggle = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div style={{ display: "flex", gap: 4, background: THEME.bg, padding: 3, borderRadius: 7 }}>
      {["module", "activity"].map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)} style={{ padding: "6px 10px", fontSize: 11.5, fontWeight: 600, border: "none", borderRadius: 5, cursor: "pointer", background: value === t ? THEME.green : "transparent", color: value === t ? "white" : THEME.textMuted }}>
          {t === "module" ? "Module session" : "Other activity"}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end", padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Week starting</label><br /><input type="date" value={form.weekStart} onChange={(e) => setForm({ ...form, weekStart: e.target.value })} style={fieldStyle} /></div>
          <div><label style={{ fontSize: 12, color: THEME.textMuted, display: "block", marginBottom: 4 }}>Session type</label><SessionTypeToggle value={form.sessionType} onChange={(v) => setForm({ ...form, sessionType: v })} /></div>
          {form.sessionType === "module" ? (
            <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Module</label><br />
              <select value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })} style={fieldStyle}>
                <option value="">None</option>
                {detail.modules.map((m) => <option key={m.id} value={m.id}>Module {m.module_number}{m.module_name ? ` - ${m.module_name}` : ""}</option>)}
              </select>
            </div>
          ) : (
            <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Activity name</label><br /><input value={form.activityName} onChange={(e) => setForm({ ...form, activityName: e.target.value })} placeholder="e.g. Guest lecture" style={{ ...fieldStyle, width: 200 }} /></div>
          )}
          <div style={{ flex: 1, minWidth: 180 }}><label style={{ fontSize: 12, color: THEME.textMuted }}>Details / topics</label><br /><input value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="What will happen this session" style={{ ...fieldStyle, width: "100%", boxSizing: "border-box" }} /></div>
          <button onClick={add} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add to plan</button>
        </div>
      )}
      {sorted.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13, padding: "20px 0" }}>No weekly entries yet. Add your first week above.</div> : (
        <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
          {sorted.map((w) => {
            const mod = detail.modules.find((m) => m.id === w.module_id);
            const isEditing = editingId === w.id;
            return (
              <div key={w.id} style={{ padding: "14px 16px", borderBottom: `1px solid ${THEME.border}` }}>
                {isEditing ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <input type="date" value={editForm.weekStart} onChange={(e) => setEditForm({ ...editForm, weekStart: e.target.value })} style={fieldStyle} />
                    <SessionTypeToggle value={editForm.sessionType} onChange={(v) => setEditForm({ ...editForm, sessionType: v })} />
                    {editForm.sessionType === "module" ? (
                      <select value={editForm.moduleId} onChange={(e) => setEditForm({ ...editForm, moduleId: e.target.value })} style={fieldStyle}>
                        <option value="">None</option>
                        {detail.modules.map((m) => <option key={m.id} value={m.id}>Module {m.module_number}{m.module_name ? ` - ${m.module_name}` : ""}</option>)}
                      </select>
                    ) : (<input value={editForm.activityName} onChange={(e) => setEditForm({ ...editForm, activityName: e.target.value })} style={fieldStyle} />)}
                    <input value={editForm.topics} onChange={(e) => setEditForm({ ...editForm, topics: e.target.value })} style={{ ...fieldStyle, flex: 1, minWidth: 160 }} />
                    <button onClick={() => saveEdit(w.id)} style={{ padding: "8px 14px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 12.5, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ padding: "8px 14px", borderRadius: 7, border: `1px solid ${THEME.border}`, background: "none", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: THEME.navy }}>Week of {new Date(w.week_start_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
                        {w.session_type === "activity" ? (<span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: THEME.purpleLight, color: THEME.purple }}>{w.activity_name || "Activity"}</span>) : mod && (<span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: THEME.greenLight, color: THEME.greenDark }}>Module {mod.module_number}</span>)}
                      </div>
                      <div style={{ fontSize: 13, color: THEME.textMuted, marginTop: 4 }}>{w.topics}</div>
                    </div>
                    {canEdit && (<div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "start" }}><button onClick={() => startEdit(w)} style={{ fontSize: 11.5, background: "none", border: "none", color: THEME.greenDark, cursor: "pointer", fontWeight: 600 }}>Edit</button><button onClick={() => remove(w.id)} style={{ fontSize: 11.5, background: "none", border: "none", color: THEME.textFaint, cursor: "pointer" }}>Delete</button></div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Assignments({ detail, courseId, onRefresh }: { detail: CourseDetail; courseId: string; onRefresh: () => void }) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [deadline, setDeadline] = useState("");
  const canEdit = detail.canEdit;
  const add = async () => { if (!title || !deadline) return; await api(`/api/courses/${courseId}/assignments`, { method: "POST", body: JSON.stringify({ title, description, deadline }) }); setTitle(""); setDescription(""); setDeadline(""); onRefresh(); };
  const remove = async (id: string) => { await api(`/api/courses/${courseId}/assignments?id=${id}`, { method: "DELETE" }); onRefresh(); };
  const sorted = [...detail.assignments].sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline));

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 20, padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10, color: THEME.navy }}>Give a new assignment</div>
          <input placeholder="Assignment title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }} />
          <textarea placeholder="What is this assignment about?" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, marginBottom: 8, boxSizing: "border-box", minHeight: 60 }} />
          <label style={{ fontSize: 12, color: THEME.textMuted }}>Submission date</label><br />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }} />
            <button onClick={add} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Post assignment</button>
          </div>
        </div>
      )}
      {sorted.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13 }}>No assignments given yet.</div> : (
        <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
          {sorted.map((a) => {
            const overdue = new Date(a.deadline) < new Date();
            return (
              <div key={a.id} style={{ padding: "14px 16px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div><div style={{ fontWeight: 600, fontSize: 13.5, color: THEME.navy }}>{a.title}</div>{a.description && <div style={{ fontSize: 13, color: THEME.textMuted, marginTop: 2 }}>{a.description}</div>}</div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: overdue ? "#FCEBEB" : THEME.greenLight, color: overdue ? "#791F1F" : THEME.greenDark, display: "inline-block" }}>{overdue ? "Overdue — was due " : "Submission date: "}{new Date(a.deadline).toLocaleDateString("en-IN")}</div>
                  {canEdit && <div><button onClick={() => remove(a.id)} style={{ marginTop: 6, fontSize: 11.5, background: "none", border: "none", color: THEME.textFaint, cursor: "pointer" }}>Remove</button></div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tests({ detail, courseId, onRefresh }: { detail: CourseDetail; courseId: string; onRefresh: () => void }) {
  const [type, setType] = useState("internal"); const [date, setDate] = useState("");
  const canEdit = detail.canEdit;
  const add = async () => { if (!date) return; await api(`/api/courses/${courseId}/tests`, { method: "POST", body: JSON.stringify({ testType: type, testDate: date }) }); setDate(""); onRefresh(); };
  const remove = async (id: string) => { await api(`/api/courses/${courseId}/tests?id=${id}`, { method: "DELETE" }); onRefresh(); };
  const sorted = [...detail.tests].sort((a, b) => +new Date(a.test_date) - +new Date(b.test_date));

  return (
    <div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "flex-end", padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Type</label><br /><select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }}><option value="internal">Internal test</option><option value="surprise">Surprise test</option></select></div>
          <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Date</label><br /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }} /></div>
          <button onClick={add} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Schedule test</button>
        </div>
      )}
      {sorted.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13 }}>No tests scheduled yet.</div> : (
        <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
          {sorted.map((t) => (
            <div key={t.id} style={{ padding: "14px 16px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.test_type === "surprise" ? "Surprise test" : "Internal test"}</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 13, color: THEME.textMuted }}>{new Date(t.test_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
                {canEdit && <button onClick={() => remove(t.id)} style={{ fontSize: 11.5, background: "none", border: "none", color: THEME.textFaint, cursor: "pointer" }}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Marks({ detail: savedDetail, students, courseId, isAdmin, onRefresh }: { detail: CourseDetail; students: StudentRow[]; courseId: string; isAdmin: boolean; onRefresh: () => unknown }) {
  const canEdit = savedDetail.canEdit;
  const draft = useDraft(`marks-${courseId}`, onRefresh);
  const scoreKey = (sid: string, cid: string) => `score:${sid}:${cid}`;
  const sumKey = (sid: string) => `sum:${sid}`;
  const setScore = (studentRosterId: string, componentId: string, value: string) => {
    const original = savedDetail.scores[studentRosterId]?.[componentId] ?? "";
    // A cleared box is treated as "no change" (marks are never deleted from here).
    const v = value === "" ? original : value;
    draft.stage(scoreKey(studentRosterId, componentId), v, (marks) => api(`/api/courses/${courseId}/scores`, { method: "POST", body: JSON.stringify({ studentRosterId, componentId, marks: Number(marks) }) }), original);
  };
  const setSummative = (studentRosterId: string, value: string) => {
    const original = savedDetail.summativeMarks[studentRosterId] ?? "";
    const v = value === "" ? original : value;
    draft.stage(sumKey(studentRosterId), v, (marks) => api(`/api/courses/${courseId}/summative`, { method: "POST", body: JSON.stringify({ studentRosterId, marks: Number(marks) }) }), original);
  };
  // Show totals with unsaved marks included, so the table reflects what will be saved.
  const detail: CourseDetail = {
    ...savedDetail,
    scores: Object.fromEntries(students.map((s) => [s.id, Object.fromEntries(savedDetail.components.map((c) => [c.id, draft.get(scoreKey(s.id, c.id), savedDetail.scores[s.id]?.[c.id])]).filter(([, v]) => v !== undefined && v !== ""))])),
    summativeMarks: Object.fromEntries(students.map((s) => [s.id, draft.get(sumKey(s.id), savedDetail.summativeMarks[s.id])]).filter(([, v]) => v !== undefined && v !== "")),
  };
  const fMax = formativeMax(savedDetail);
  const eMax = externalMax(savedDetail.course);
  const togglePublish = async () => { await api(`/api/courses/${courseId}`, { method: "PATCH", body: JSON.stringify({ resultsPublished: !detail.course.results_published }) }); onRefresh(); };

  const downloadExcel = () => {
    if (draft.count && !window.confirm("You have unsaved marks. The Excel file will include only saved marks. Continue?")) return;
    const detail = savedDetail;
    const rows = students.map((s) => {
      const displayName = s.name?.trim() ? s.name : s.label;
      const row: Record<string, any> = { Student: displayName };
      detail.components.forEach((c) => {
        let val;
        if (isAttendanceComponent(c.component_name)) {
          const total = detail.attendanceSessions.length;
          const present = Object.values(detail.attendanceRecords[s.id] || {}).filter(Boolean).length;
          val = total ? Math.round((present / total) * c.max_marks) : 0;
        } else { val = detail.scores[s.id]?.[c.id] ?? ""; }
        row[`${c.component_name} (/${c.max_marks})`] = val;
      });
      const formativeTotal = computeFormativeTotal(detail, s.id);
      const summative = detail.summativeMarks[s.id] ?? "";
      row[`Formative total (/${fMax})`] = formativeTotal;
      row[`External / Summative (/${eMax})`] = summative;
      row[`Grand total (/${fMax + eMax})`] = formativeTotal + (Number(summative) || 0);
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Marks");
    const safeName = detail.course.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    XLSX.writeFile(wb, `${safeName}_formative_summative_marks.xlsx`);
  };

  return (
    <div>
      {isAdmin && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 12 }}>
          <button onClick={togglePublish} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: detail.course.results_published ? THEME.greenLight : THEME.navy, color: detail.course.results_published ? THEME.greenDark : "white", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            <CheckCircle size={14} /> {detail.course.results_published ? "Results published to students" : "Publish results to students"}
          </button>
          <button onClick={downloadExcel} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.card, fontSize: 12.5, fontWeight: 600, color: THEME.navy, cursor: "pointer" }}>
            <Download size={14} /> Download Excel (formative + summative)
          </button>
        </div>
      )}
      <div key={draft.version} style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bg }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}>Student</th>
              {detail.components.map((c) => <th key={c.id} style={{ textAlign: "center", padding: "10px 8px", fontWeight: 600, color: THEME.navy }}>{c.component_name}{isAttendanceComponent(c.component_name) ? " (auto)" : ""} <span style={{ color: THEME.textFaint, fontWeight: 400 }}>(/{c.max_marks})</span></th>)}
              <th style={{ textAlign: "center", padding: "10px 8px", background: THEME.greenLight, color: THEME.greenDark }}>Formative total (/{fMax})</th>
              <th style={{ textAlign: "center", padding: "10px 8px", background: THEME.purpleLight, color: THEME.purple }}>External / Summative (/{eMax})</th>
              <th style={{ textAlign: "center", padding: "10px 12px", background: THEME.navy, color: "white" }}>Grand total (/{fMax + eMax})</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const row = detail.scores[s.id] || {};
              const displayName = s.name?.trim() ? s.name : s.label;
              const formativeTotal = computeFormativeTotal(detail, s.id);
              const summative = (detail.summativeMarks[s.id] as number | undefined) ?? "";
              const grand = formativeTotal + (Number(summative) || 0);
              return (
                <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "7px 12px" }}>{displayName}</td>
                  {detail.components.map((c) => {
                    if (isAttendanceComponent(c.component_name)) {
                      const total = detail.attendanceSessions.length;
                      const present = Object.values(detail.attendanceRecords[s.id] || {}).filter(Boolean).length;
                      const auto = total ? Math.round((present / total) * c.max_marks) : 0;
                      return <td key={c.id} style={{ padding: "7px 8px", textAlign: "center", color: THEME.textMuted }}>{auto} <span style={{ fontSize: 10, color: THEME.textFaint }}>({present}/{total})</span></td>;
                    }
                    return (
                      <td key={c.id} style={{ padding: "7px 8px", textAlign: "center" }}>
                        {canEdit ? (<input type="number" min={0} max={c.max_marks} defaultValue={row[c.id] ?? ""} onChange={(e) => setScore(s.id, c.id, e.target.value)} style={{ width: 50, padding: "5px", textAlign: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, ...dirtyStyle(draft.has(scoreKey(s.id, c.id))) }} />) : (row[c.id] ?? "-")}
                      </td>
                    );
                  })}
                  <td style={{ padding: "7px 8px", textAlign: "center", fontWeight: 700, color: THEME.greenDark, background: "#F7FBF1" }}>{formativeTotal}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", background: "#FAF8FD" }}>
                    {canEdit ? (<input type="number" min={0} max={eMax} defaultValue={summative} onChange={(e) => setSummative(s.id, e.target.value)} style={{ width: 50, padding: "5px", textAlign: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, ...dirtyStyle(draft.has(sumKey(s.id))) }} />) : (summative === "" ? "-" : summative)}
                  </td>
                  <td style={{ padding: "7px 12px", textAlign: "center", fontWeight: 700, color: THEME.navy }}>{grand}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: THEME.textFaint }}>The Attendance component fills in automatically from the Attendance tab.</div>
      {canEdit && <SaveBar draft={draft} />}
    </div>
  );
}

function Attendance({ detail, students, courseId, onRefresh }: { detail: CourseDetail; students: StudentRow[]; courseId: string; onRefresh: () => unknown }) {
  const [newDate, setNewDate] = useState("");
  const canEdit = detail.canEdit;
  const draft = useDraft(`attendance-${courseId}`, onRefresh);
  const attKey = (sid: string, sessId: string) => `att:${sid}:${sessId}`;
  const isPresent = (sid: string, sessId: string) => draft.get(attKey(sid, sessId), !!detail.attendanceRecords[sid]?.[sessId]);
  const addSession = async () => { if (!newDate) return; await api(`/api/courses/${courseId}/attendance/sessions`, { method: "POST", body: JSON.stringify({ sessionDate: newDate }) }); setNewDate(""); await onRefresh(); };
  const removeSession = async (id: string) => {
    if (!window.confirm("Remove this lecture session and its attendance marks?")) return;
    await api(`/api/courses/${courseId}/attendance/sessions?id=${id}`, { method: "DELETE" });
    draft.drop((k) => k.endsWith(`:${id}`));
    await onRefresh();
  };
  const toggle = (studentRosterId: string, sessionId: string) => {
    const next = !isPresent(studentRosterId, sessionId);
    draft.stage(attKey(studentRosterId, sessionId), next,
      (present) => api(`/api/courses/${courseId}/attendance/records`, { method: "POST", body: JSON.stringify({ sessionId, studentRosterId, present }) }),
      !!detail.attendanceRecords[studentRosterId]?.[sessionId]);
  };
  const markAll = (sessionId: string, present: boolean) => students.forEach((s) =>
    draft.stage(attKey(s.id, sessionId), present,
      (p) => api(`/api/courses/${courseId}/attendance/records`, { method: "POST", body: JSON.stringify({ sessionId, studentRosterId: s.id, present: p }) }),
      !!detail.attendanceRecords[s.id]?.[sessionId]));
  const sessions = [...detail.attendanceSessions].sort((a, b) => +new Date(a.session_date) - +new Date(b.session_date));

  return (
    <div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "flex-end", padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Lecture date</label><br /><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }} /></div>
          <button onClick={addSession} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add lecture session</button>
        </div>
      )}
      {sessions.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13 }}>No lecture sessions recorded yet.</div> : (
        <div style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 500 + sessions.length * 60 }}>
            <thead><tr style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bg }}>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Student</th>
              {sessions.map((s) => {
                const allPresent = students.length > 0 && students.every((st) => isPresent(st.id, s.id));
                return (<th key={s.id} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 600 }}><div>{new Date(s.session_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>{canEdit && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}><button onClick={() => markAll(s.id, !allPresent)} style={{ fontSize: 10, color: THEME.greenDark, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>{allPresent ? "clear all" : "all present"}</button><button onClick={() => removeSession(s.id)} style={{ fontSize: 10, color: THEME.textFaint, background: "none", border: "none", cursor: "pointer" }}>remove</button></div>}</th>);
              })}
              <th style={{ padding: "8px 10px", textAlign: "center" }}>Attended</th><th style={{ padding: "8px 10px", textAlign: "center" }}>%</th>
            </tr></thead>
            <tbody>
              {students.map((s) => {
                const present = sessions.filter((sess) => isPresent(s.id, sess.id)).length;
                const pct = sessions.length ? Math.round((present / sessions.length) * 100) : 0;
                const displayName = s.name?.trim() ? s.name : s.label;
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                    <td style={{ padding: "6px 10px" }}>{displayName}</td>
                    {sessions.map((sess) => (<td key={sess.id} style={{ padding: "6px", textAlign: "center", background: draft.has(attKey(s.id, sess.id)) ? "#FFF3DF" : undefined }}><input type="checkbox" checked={isPresent(s.id, sess.id)} disabled={!canEdit} onChange={() => toggle(s.id, sess.id)} style={{ width: 15, height: 15, cursor: canEdit ? "pointer" : "default" }} /></td>))}
                    <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 600 }}>{present}/{sessions.length}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 600, color: pct >= 75 ? THEME.greenDark : "#A32D2D" }}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && sessions.length > 0 && <SaveBar draft={draft} />}
    </div>
  );
}

function FacultyPayout({ batchId }: { batchId: string }) {
  const [facultyList, setFacultyList] = useState<any[]>([]);
  const [facultyId, setFacultyId] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [newDate, setNewDate] = useState(""); const [newTopic, setNewTopic] = useState(""); const [newHours, setNewHours] = useState(2);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api(`/api/admin/credentials?batchId=${batchId}`).then((d) => {
      setFacultyList(d.faculty);
      setFacultyId(d.faculty[0]?.id || "");
    });
  }, [batchId]);

  const loadSessions = useCallback(async (fid: string) => { if (!fid) { setSessions([]); return; } const d = await api(`/api/faculty-sessions?facultyId=${fid}`); setSessions(d.sessions || []); }, []);
  useEffect(() => { loadSessions(facultyId); }, [facultyId, loadSessions]);

  const faculty = facultyList.find((f) => f.id === facultyId);

  const addSession = async () => {
    if (!newDate || !newHours || !facultyId) return;
    await api("/api/faculty-sessions", { method: "POST", body: JSON.stringify({ facultyId, courseId: faculty?.course_id || null, date: newDate, topic: newTopic, hours: Number(newHours), rate: faculty?.pay_rate || 0 }) });
    setNewDate(""); setNewTopic(""); setNewHours(2);
    loadSessions(facultyId);
  };
  const removeSession = async (id: string) => { await api(`/api/faculty-sessions/${id}`, { method: "DELETE" }); loadSessions(facultyId); };
  const updateSession = async (id: string, patch: any) => { await api(`/api/faculty-sessions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); loadSessions(facultyId); };
  const draft = useDraft("faculty-payout", () => loadSessions(facultyId));
  const stageNum = (id: string, field: "hours" | "rate", value: string, original: number) =>
    draft.stage(`fs:${id}:${field}`, Number(value), (v) => api(`/api/faculty-sessions/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: v }) }), Number(original));
  const hoursOf = (x: any) => Number(draft.get(`fs:${x.id}:hours`, x.hours)) || 0;
  const rateOf = (x: any) => Number(draft.get(`fs:${x.id}:rate`, x.rate)) || 0;
  const toggleSelect = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const markSelectedPaid = async () => { await Promise.all(Object.entries(selected).filter(([, v]) => v).map(([id]) => api(`/api/faculty-sessions/${id}`, { method: "PATCH", body: JSON.stringify({ paid: true }) }))); setSelected({}); loadSessions(facultyId); };

  const totalUnpaid = sessions.filter((s) => !s.paid).reduce((sum, s) => sum + hoursOf(s) * rateOf(s), 0);
  const totalAll = sessions.reduce((sum, s) => sum + hoursOf(s) * rateOf(s), 0);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Faculty payouts</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Log hours worked per day. Only faculty teaching in this batch are listed here.</div>
      </div>

      {facultyList.length === 0 ? (
        <div style={{ color: THEME.textFaint, fontSize: 13 }}>No faculty are teaching a course in this batch yet, so there's nothing to log payouts for.</div>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: THEME.textMuted }}>Faculty</label><br />
            <select value={facultyId} onChange={(e) => { if (!draft.count || window.confirm("You have unsaved changes for this faculty member. Discard them?")) { draft.discard(); setFacultyId(e.target.value); } }} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, minWidth: 220 }}>
              {facultyList.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.pay_rate ? `₹${f.pay_rate}/hr` : "no rate set"}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20, padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
            <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Date</label><br /><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Topic (optional)</label><br /><input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="What was covered" style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, width: 180 }} /></div>
            <div><label style={{ fontSize: 12, color: THEME.textMuted }}>Hours worked</label><br /><input type="number" min={0} step={0.5} value={newHours} onChange={(e) => setNewHours(Number(e.target.value))} style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, width: 80 }} /></div>
            <button onClick={addSession} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.green, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add entry</button>
          </div>

          {sessions.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13 }}>No hours logged yet for this faculty member.</div> : (
            <>
              <div key={draft.version} style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 780 }}>
                  <thead><tr style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bg, textAlign: "left" }}>
                    <th style={{ padding: "8px" }}></th><th style={{ padding: "8px" }}>Date</th><th style={{ padding: "8px" }}>Topic</th>
                    <th style={{ padding: "8px", textAlign: "center" }}>Hours</th><th style={{ padding: "8px", textAlign: "center" }}>Rate (₹/hr)</th>
                    <th style={{ padding: "8px", textAlign: "center" }}>Total (₹)</th><th style={{ padding: "8px", textAlign: "center" }}>Paid?</th><th style={{ padding: "8px" }}></th>
                  </tr></thead>
                  <tbody>
                    {sessions.map((s) => {
                      const rowTotal = hoursOf(s) * rateOf(s);
                      return (
                        <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                          <td style={{ padding: "6px 8px" }}><input type="checkbox" checked={!!selected[s.id]} onChange={() => toggleSelect(s.id)} disabled={s.paid} /></td>
                          <td style={{ padding: "6px 8px" }}>{new Date(s.session_date).toLocaleDateString("en-IN")}</td>
                          <td style={{ padding: "6px 8px" }}>{s.topic || "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}><input type="number" min={0} step={0.5} defaultValue={draft.get(`fs:${s.id}:hours`, s.hours)} onChange={(e) => stageNum(s.id, "hours", e.target.value, s.hours)} style={{ width: 55, padding: "4px", textAlign: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, ...dirtyStyle(draft.has(`fs:${s.id}:hours`)) }} disabled={s.paid} /></td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}><input type="number" defaultValue={draft.get(`fs:${s.id}:rate`, s.rate)} onChange={(e) => stageNum(s.id, "rate", e.target.value, s.rate)} style={{ width: 65, padding: "4px", textAlign: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, ...dirtyStyle(draft.has(`fs:${s.id}:rate`)) }} disabled={s.paid} /></td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: 700, color: THEME.greenDark }}>₹{rowTotal.toLocaleString("en-IN")}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}><button onClick={() => updateSession(s.id, { paid: !s.paid })} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", background: s.paid ? THEME.greenLight : "#FCEBEB", color: s.paid ? THEME.greenDark : "#A32D2D" }}>{s.paid ? "Paid" : "Unpaid"}</button></td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}><button onClick={() => removeSession(s.id)} style={{ fontSize: 11, background: "none", border: "none", color: THEME.textFaint, cursor: "pointer" }}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontSize: 13.5, color: THEME.textMuted }}>Total (all time): <strong style={{ color: THEME.navy }}>₹{totalAll.toLocaleString("en-IN")}</strong> · Still owed: <strong style={{ color: "#A32D2D" }}>₹{totalUnpaid.toLocaleString("en-IN")}</strong></div>
                <button onClick={markSelectedPaid} disabled={!Object.values(selected).some(Boolean)} style={{ padding: "9px 18px", borderRadius: 7, border: "none", background: THEME.navy, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: Object.values(selected).some(Boolean) ? 1 : 0.5 }}>Mark selected as Paid</button>
              </div>
              <SaveBar draft={draft} />
            </>
          )}
        </>
      )}
    </div>
  );
}

const PLAN_FIELDS: [string, string][] = [["token", "Token"], ["inst1", "Instalment 1"], ["inst2", "Instalment 2"], ["inst3", "Instalment 3"], ["inst4", "Instalment 4"]];

function StudentFees({ batchId, students, onStudentsChanged }: { batchId: string; students: StudentRow[]; onStudentsChanged: () => void }) {
  const [category, setCategory] = useState("General");
  const [plans, setPlans] = useState<Record<string, any>>({});
  const [payments, setPayments] = useState<Record<string, Record<string, number>>>({});

  const loadPlans = useCallback(async () => { const d = await api(`/api/fee-plans?batchId=${batchId}`); const map: Record<string, any> = {}; d.plans.forEach((p: any) => { map[p.category] = p; }); setPlans(map); }, [batchId]);
  const loadPayments = useCallback(async () => {
    const d = await api(`/api/student-fees?batchId=${batchId}`);
    const map: Record<string, Record<string, number>> = {};
    d.payments.forEach((p: any) => { if (!map[p.student_roster_id]) map[p.student_roster_id] = {}; map[p.student_roster_id][p.field] = Number(p.amount_paid); });
    setPayments(map);
  }, [batchId]);
  useEffect(() => { loadPlans(); loadPayments(); }, [loadPlans, loadPayments]);

  const draft = useDraft("student-fees", async () => { await Promise.all([loadPlans(), loadPayments(), onStudentsChanged()]); });
  const EMPTY_PLAN = { token: 0, inst1: 0, inst2: 0, inst3: 0, inst4: 0 };
  // Plan values with unsaved edits applied, per category.
  const planFor = (cat: string) => {
    const saved = plans[cat] || EMPTY_PLAN;
    return Object.fromEntries(PLAN_FIELDS.map(([f]) => [f, draft.get(`plan:${cat}:${f}`, saved[f])])) as Record<string, number>;
  };
  const plan = planFor(category);
  const updatePlanField = (field: string, value: string) => {
    const cat = category;
    draft.stage(`plan:${cat}:${field}`, Number(value) || 0, (v) => api("/api/fee-plans", { method: "PATCH", body: JSON.stringify({ batchId, category: cat, field, value: v }) }), Number((plans[cat] || EMPTY_PLAN)[field]) || 0);
  };
  const setPaid = (studentRosterId: string, field: string, value: string) =>
    draft.stage(`pay:${studentRosterId}:${field}`, Number(value) || 0, (v) => api("/api/student-fees", { method: "POST", body: JSON.stringify({ studentRosterId, field, amountPaid: v }) }), Number(payments[studentRosterId]?.[field]) || 0);
  const setStudentCategory = (s: StudentRow, cat: string) =>
    draft.stage(`cat:${s.id}`, cat, (v) => api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ feeCategory: v }) }), s.fee_category || "General");

  return (
    <div>
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>Student fees</div><div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Set the fee plan per category, then track each student's actual payments.</div></div>

      <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.navy }}>Fee plan</div>
          <div style={{ display: "flex", gap: 4, background: THEME.bg, padding: 3, borderRadius: 7 }}>
            {["General", "Reserved"].map((c) => (<button key={c} onClick={() => setCategory(c)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 5, cursor: "pointer", background: category === c ? THEME.green : "transparent", color: category === c ? "white" : THEME.textMuted }}>{c}</button>))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {PLAN_FIELDS.map(([field, label]) => (
            <div key={field}><label style={{ fontSize: 11.5, color: THEME.textMuted }}>{label} (₹)</label><br /><input key={`${category}-${field}-${draft.version}-${plans[category]?.[field] ?? 0}`} type="number" defaultValue={plan[field]} onChange={(e) => updatePlanField(field, e.target.value)} style={{ width: 100, padding: "7px 9px", borderRadius: 7, border: `1px solid ${THEME.border}`, fontSize: 13, ...dirtyStyle(draft.has(`plan:${category}:${field}`)) }} /></div>
          ))}
        </div>
      </div>

      <div key={draft.version} style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1000 }}>
          <thead><tr style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bg, textAlign: "left" }}>
            <th style={{ padding: "8px" }}>Student</th><th style={{ padding: "8px" }}>Category</th>
            {PLAN_FIELDS.map(([field, label]) => <th key={field} style={{ padding: "8px", textAlign: "center" }}>{label}</th>)}
            <th style={{ padding: "8px", textAlign: "center" }}>Paid</th><th style={{ padding: "8px", textAlign: "center" }}>Balance</th>
          </tr></thead>
          <tbody>
            {students.map((s) => {
              const cat = draft.get(`cat:${s.id}`, s.fee_category || "General");
              const studentPlan = planFor(cat);
              const totalDue = PLAN_FIELDS.reduce((sum, [f]) => sum + (Number(studentPlan[f]) || 0), 0);
              const studentPayments = Object.fromEntries(PLAN_FIELDS.map(([f]) => [f, draft.get(`pay:${s.id}:${f}`, payments[s.id]?.[f] ?? 0)]));
              const paid = PLAN_FIELDS.reduce((sum, [f]) => sum + Math.min(Number(studentPayments[f]) || 0, Number(studentPlan[f]) || 0), 0);
              const displayName = s.name?.trim() ? s.name : s.label;
              return (
                <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "6px 8px" }}>{displayName}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <select value={cat} onChange={(e) => setStudentCategory(s, e.target.value)} style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${THEME.border}`, fontSize: 11.5, ...dirtyStyle(draft.has(`cat:${s.id}`)) }}>
                      <option value="General">General</option><option value="Reserved">Reserved</option>
                    </select>
                  </td>
                  {PLAN_FIELDS.map(([field]) => {
                    const due = Number(studentPlan[field]) || 0;
                    const paidAmt = Number(studentPayments[field]) || 0;
                    const status = paidAmt <= 0 ? "not paid" : paidAmt >= due ? "paid in full" : "partial";
                    const cellBg = status === "paid in full" ? THEME.greenLight : status === "partial" ? THEME.orangeLight : "#FCEBEB";
                    const cellText = status === "paid in full" ? THEME.greenDark : status === "partial" ? THEME.orange : "#A32D2D";
                    return (
                      <td key={field} style={{ padding: "6px 8px", textAlign: "center", background: cellBg }}>
                        <div style={{ fontSize: 10, color: THEME.textFaint, marginBottom: 3 }}>Due ₹{due.toLocaleString("en-IN")}</div>
                        <input type="number" min={0} defaultValue={paidAmt} onChange={(e) => setPaid(s.id, field, e.target.value)} style={{ width: 72, padding: "4px", textAlign: "center", borderRadius: 6, border: `1px solid ${THEME.border}`, fontSize: 11.5, ...dirtyStyle(draft.has(`pay:${s.id}:${field}`)) }} />
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: cellText, marginTop: 2, textTransform: "capitalize" }}>{status}</div>
                      </td>
                    );
                  })}
                  <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: 700, color: THEME.greenDark }}>₹{paid.toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: 700, color: totalDue - paid > 0 ? "#A32D2D" : THEME.greenDark }}>₹{(totalDue - paid).toLocaleString("en-IN")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar draft={draft} />
    </div>
  );
}

function MyResults({ courses, studentId }: { courses: CourseSummary[]; studentId: string }) {
  const [details, setDetails] = useState<Record<string, CourseDetail>>({});
  useEffect(() => {
    const published = courses.filter((c) => c.results_published);
    Promise.all(published.map((c) => api(`/api/courses/${c.id}`))).then((results) => {
      const map: Record<string, CourseDetail> = {};
      results.forEach((d: CourseDetail, i: number) => { map[published[i].id] = d; });
      setDetails(map);
    });
  }, [courses]);

  const published = courses.filter((c) => c.results_published);

  return (
    <div>
      <div style={{ marginBottom: 20 }}><div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>My results</div><div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Only shows subjects where your Operations team has published results.</div></div>
      {published.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13, padding: "20px 0" }}>No results have been published yet. Check back later.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {published.map((c) => {
            const detail = details[c.id];
            if (!detail) return null;
            const formativeTotal = computeFormativeTotal(detail, studentId);
            const summative = detail.summativeMarks[studentId] ?? 0;
            const grand = formativeTotal + (Number(summative) || 0);
            const row = detail.scores[studentId] || {};
            const fMax = formativeMax(detail);
            const eMax = externalMax(detail.course);
            const gMax = fMax + eMax;
            return (
              <div key={c.id} style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: THEME.navy }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "white" }}>{c.name}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: THEME.green }}>{grand} / {gMax}</div>
                </div>
                <div style={{ padding: "10px 16px 4px", fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: THEME.textFaint, textTransform: "uppercase" }}>Internal marks (out of {fMax})</div>
                {detail.components.map((comp) => {
                  let val;
                  if (isAttendanceComponent(comp.component_name)) {
                    const total = detail.attendanceSessions.length;
                    const present = Object.values(detail.attendanceRecords[studentId] || {}).filter(Boolean).length;
                    val = total ? Math.round((present / total) * comp.max_marks) : 0;
                  } else { val = row[comp.id] ?? 0; }
                  return (<div key={comp.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderTop: `1px solid ${THEME.border}`, fontSize: 13 }}><span>{comp.component_name}</span><span style={{ fontWeight: 600, color: THEME.navy }}>{val} / {comp.max_marks}</span></div>);
                })}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 16px", borderTop: `1px solid ${THEME.border}`, background: THEME.greenLight }}><span style={{ fontSize: 13, fontWeight: 700, color: THEME.greenDark }}>Internal total</span><span style={{ fontSize: 13, fontWeight: 700, color: THEME.greenDark }}>{formativeTotal} / {fMax}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderTop: `1px solid ${THEME.border}`, background: THEME.purpleLight }}><span style={{ fontSize: 13.5, fontWeight: 700, color: THEME.purple }}>External / Summative marks</span><span style={{ fontSize: 13.5, fontWeight: 700, color: THEME.purple }}>{summative} / {eMax}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px", background: THEME.navy }}><span style={{ fontSize: 14, fontWeight: 700, color: "white" }}>Total marks</span><span style={{ fontSize: 14, fontWeight: 700, color: THEME.green }}>{grand} / {gMax} ({gMax ? Math.round((grand / gMax) * 100) : 0}%)</span></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MisReports({ courses, batchId, semesterId, batchName }: { courses: CourseSummary[]; batchId: string; semesterId: string | null; batchName: string }) {
  const [period, setPeriod] = useState<"week" | "month" | "overall">("week");
  const [courseId, setCourseId] = useState("all");
  // A subject from another semester can't stay selected after switching semester.
  useEffect(() => { if (courseId !== "all" && !courses.some((c) => c.id === courseId)) setCourseId("all"); }, [courses, courseId]);
  const [data, setData] = useState<MisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api(`/api/reports/mis?batchId=${batchId}&period=${period}&courseId=${courseId}${semesterId ? `&semesterId=${semesterId}` : ""}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [batchId, semesterId, period, courseId]);

  const download = async () => {
    if (!data) return;
    setDownloading(true); setError("");
    try {
      const { buildMisReportPdf } = await import("@/lib/misReport");
      const { doc, filename } = await buildMisReportPdf(data);
      doc.save(filename);
    } catch (e: any) {
      setError(`Could not create the PDF: ${e.message || e}`);
    } finally { setDownloading(false); }
  };

  const PERIODS: [typeof period, string, string][] = [
    ["week", "Last 7 days", "Weekly"], ["month", "Last 30 days", "Monthly"], ["overall", "Overall", "Till date"],
  ];
  const below = data ? data.students.filter((s) => s.pct !== null && s.pct < 75).length : 0;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: THEME.navy }}>MIS reports</div>
        <div style={{ fontSize: 13.5, color: THEME.textMuted, marginTop: 4 }}>Download a PDF report of attendance and course progress for {batchName || "this batch"}, with charts and a written explanation under each chart.</div>
      </div>

      <div style={{ padding: 18, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 6 }}>Period</div>
            <div style={{ display: "flex", gap: 4, background: THEME.bg, padding: 4, borderRadius: 9 }}>
              {PERIODS.map(([key, label, sub]) => (
                <button key={key} onClick={() => setPeriod(key)} style={{ padding: "7px 14px", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
                  background: period === key ? THEME.green : "transparent", color: period === key ? "white" : THEME.textMuted }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.85 }}>{sub}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 6 }}>Subject</div>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13, minWidth: 260 }}>
              <option value="all">All subjects (overall + subject-wise)</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={download} disabled={!data || loading || downloading}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 20px", borderRadius: 8, border: "none", background: THEME.navy, color: "white", fontSize: 13.5, fontWeight: 700,
              cursor: data && !loading && !downloading ? "pointer" : "default", opacity: data && !loading && !downloading ? 1 : 0.6 }}>
            <Download size={16} /> {downloading ? "Preparing PDF…" : "Download PDF report"}
          </button>
        </div>
        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#A32D2D" }}>{error}</div>}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.navy, marginBottom: 10 }}>
        Preview {data && <span style={{ fontWeight: 400, color: THEME.textMuted }}>· {data.periodLabel}{data.startDate ? ` · ${new Date(`${data.startDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} – ${new Date(`${data.endDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}</span>}
      </div>
      {loading ? <div style={{ color: THEME.textMuted, fontSize: 13, marginBottom: 20 }}>Loading figures…</div> : data && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard icon={ClipboardCheck} label="Average attendance" value={data.overall.pct !== null ? `${data.overall.pct}%` : "No data"}
            sub={data.overall.prevPct !== null && data.overall.pct !== null ? `${data.overall.pct - data.overall.prevPct >= 0 ? "+" : ""}${Math.round((data.overall.pct - data.overall.prevPct) * 10) / 10} pts vs previous period` : `${data.studentCount} students`}
            accent={data.overall.pct !== null && data.overall.pct < 75 ? "#C23B3B" : THEME.green} />
          <StatCard icon={CalendarDays} label="Lectures held" value={data.overall.sessions} sub={data.scope ? data.scope.courseName : `across ${data.subjects.length} subjects`} />
          <StatCard icon={TrendingUp} label="Syllabus completed" value={`${data.progress.pct}%`} sub={`${data.progress.modulesCompleted} of ${data.progress.modulesTotal} modules`} accent={THEME.green} />
          <StatCard icon={Users} label="Students below 75%" value={below} sub={`of ${data.studentCount} students`} accent={below ? "#C23B3B" : THEME.green} />
        </div>
      )}

      <div style={{ padding: 16, border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.bg, fontSize: 13, color: THEME.textMuted, lineHeight: 1.6 }}>
        <strong style={{ color: THEME.navy }}>What the PDF contains.</strong> A summary page with the headline figures and key findings, then an attendance section (attendance by {courseId === "all" ? "subject" : "lecture session"}, the attendance trend over the period, students grouped by attendance band, and a follow-up list of students below 75%), then a course progress section (syllabus progress{courseId === "all" ? " by subject" : " and a module-by-module status"}). Every chart has a plain-English explanation of what it shows. Weekly and monthly reports also compare attendance with the previous period.
      </div>
    </div>
  );
}

function AuditLog({ log }: { log: AuditEntry[] }) {
  return (
    <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 12, background: THEME.card, overflow: "hidden" }}>
      {log.length === 0 ? <div style={{ color: THEME.textFaint, fontSize: 13, padding: 16 }}>No changes recorded yet.</div> : log.map((e) => (
        <div key={e.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <div><strong style={{ fontWeight: 600, color: THEME.navy }}>{e.actor_name}</strong> <span style={{ color: THEME.textMuted }}>— {e.action}</span></div>
          <div style={{ color: THEME.textFaint, flexShrink: 0, marginLeft: 12 }}>{new Date(e.changed_at).toLocaleString("en-IN")}</div>
        </div>
      ))}
    </div>
  );
}

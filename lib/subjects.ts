import type { PoolClient } from "pg";

// Shared helpers for creating and editing subjects (courses), their modules,
// and their internal-assessment pattern (assessment_components).

export const VALID_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type ModuleInput = { id?: string | null; name: string };
export type ComponentInput = { id?: string | null; name: string; maxMarks: number };

// Subject codes must be unique across the whole portal. If the wanted code is
// taken (or none was given), build one from the subject's initials and add a
// number until it is free, e.g. "FM", "FM2", "FM3".
export async function uniqueCode(client: PoolClient, wanted: string | null | undefined, name: string, excludeCourseId?: string): Promise<string> {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
  let base = clean(wanted || "");
  if (!base) {
    base = clean(name.split(/[^A-Za-z0-9]+/).filter((w) => w && !["and", "of", "the", "for", "in"].includes(w.toLowerCase())).map((w) => w[0]).join("")) || "SUB";
  }
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 16)}${n}`;
    const res = await client.query(
      "SELECT 1 FROM courses WHERE upper(code) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)",
      [candidate, excludeCourseId || null]
    );
    if (res.rows.length === 0) return candidate;
  }
  throw new Error("Could not find a free subject code.");
}

export function validateSubject(body: any, { partial = false } = {}): string | null {
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) return "Please enter the subject name.";
  }
  if (!partial || body.facultyId !== undefined) {
    if (!body.facultyId) return "Please choose the faculty member who teaches this subject.";
  }
  if (body.dayAllocated && !VALID_DAYS.includes(body.dayAllocated)) return "Invalid day.";
  if (body.dayParity && !["odd", "even"].includes(body.dayParity)) return "Invalid week pattern.";
  if (body.totalHours !== undefined && body.totalHours !== null && body.totalHours !== "" && (isNaN(Number(body.totalHours)) || Number(body.totalHours) < 0)) return "Total hours must be a positive number.";
  if (body.externalMaxMarks !== undefined && (isNaN(Number(body.externalMaxMarks)) || Number(body.externalMaxMarks) < 0 || Number(body.externalMaxMarks) > 500)) return "External marks must be between 0 and 500.";
  if (body.components !== undefined) {
    if (!Array.isArray(body.components)) return "Invalid internal pattern.";
    for (const c of body.components) {
      if (!c.name || !String(c.name).trim()) return "Every internal component needs a name.";
      const m = Number(c.maxMarks);
      if (isNaN(m) || m <= 0 || m > 500 || !Number.isInteger(m)) return `"${c.name}" needs whole-number marks above 0.`;
    }
  }
  if (body.modules !== undefined) {
    if (!Array.isArray(body.modules)) return "Invalid module list.";
    if (body.modules.length > 60) return "A subject can have at most 60 modules.";
  }
  return null;
}

// Make a subject's modules match the list given (in order). Existing modules
// keep their status and completion date; removed ones are deleted.
export async function syncModules(client: PoolClient, courseId: string, modules: ModuleInput[], userId: string) {
  const existing = await client.query("SELECT id FROM modules WHERE course_id = $1", [courseId]);
  const existingIds = new Set(existing.rows.map((r) => r.id));
  const keepIds = new Set(modules.filter((m) => m.id && existingIds.has(m.id)).map((m) => m.id));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length) {
    await client.query("UPDATE weekly_plans SET module_id = NULL WHERE module_id = ANY($1::uuid[])", [toDelete]);
    await client.query("DELETE FROM modules WHERE id = ANY($1::uuid[])", [toDelete]);
  }
  // Move kept modules out of the way first so renumbering never clashes.
  await client.query("UPDATE modules SET module_number = module_number + 10000 WHERE course_id = $1", [courseId]);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const name = String(m.name || "").trim() || null;
    if (m.id && keepIds.has(m.id)) {
      await client.query("UPDATE modules SET module_number = $1, module_name = $2, updated_by = $3, updated_at = now() WHERE id = $4", [i + 1, name, userId, m.id]);
    } else {
      await client.query("INSERT INTO modules (course_id, module_number, module_name, updated_by) VALUES ($1, $2, $3, $4)", [courseId, i + 1, name, userId]);
    }
  }
}

// Make a subject's internal-assessment components match the list given.
// Removing a component also removes the marks entered against it.
export async function syncComponents(client: PoolClient, courseId: string, components: ComponentInput[]) {
  const existing = await client.query("SELECT id FROM assessment_components WHERE course_id = $1", [courseId]);
  const existingIds = new Set(existing.rows.map((r) => r.id));
  const keepIds = new Set(components.filter((c) => c.id && existingIds.has(c.id)).map((c) => c.id));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length) await client.query("DELETE FROM assessment_components WHERE id = ANY($1::uuid[])", [toDelete]);
  await client.query("UPDATE assessment_components SET display_order = display_order + 10000 WHERE course_id = $1", [courseId]);
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const name = String(c.name).trim();
    const max = Math.round(Number(c.maxMarks));
    if (c.id && keepIds.has(c.id)) {
      await client.query("UPDATE assessment_components SET component_name = $1, max_marks = $2, display_order = $3 WHERE id = $4", [name, max, i + 1, c.id]);
      // If the maximum went down, cap marks already entered so totals stay valid.
      await client.query("UPDATE student_scores SET marks_obtained = $1 WHERE component_id = $2 AND marks_obtained > $1", [max, c.id]);
    } else {
      await client.query("INSERT INTO assessment_components (course_id, component_name, max_marks, display_order) VALUES ($1, $2, $3, $4)", [courseId, name, max, i + 1]);
    }
  }
}

// Insert a brand-new subject with its modules and internal pattern.
export async function insertSubject(client: PoolClient, s: {
  batchId: string; semesterId: string; name: string; code?: string | null; facultyId: string;
  dayAllocated?: string | null; dayParity?: string | null; totalHours?: number | null; externalMaxMarks?: number;
  modules: ModuleInput[]; components: ComponentInput[];
}, userId: string) {
  const code = await uniqueCode(client, s.code, s.name);
  const res = await client.query(
    `INSERT INTO courses (name, code, day_allocated, day_parity, total_hours, faculty_id, batch_id, semester_id, external_max_marks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, code`,
    [s.name.trim(), code, s.dayAllocated || null, s.dayParity || null,
     s.totalHours === null || s.totalHours === undefined || (s.totalHours as any) === "" ? null : Math.round(Number(s.totalHours)),
     s.facultyId, s.batchId, s.semesterId, s.externalMaxMarks === undefined ? 50 : Math.round(Number(s.externalMaxMarks))]
  );
  const courseId = res.rows[0].id;
  await syncModules(client, courseId, s.modules.map((m) => ({ name: m.name })), userId);
  await syncComponents(client, courseId, s.components.map((c) => ({ name: c.name, maxMarks: c.maxMarks })));
  return res.rows[0];
}

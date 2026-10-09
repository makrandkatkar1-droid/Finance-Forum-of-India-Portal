import { query } from "@/lib/db";
import { SessionUser } from "@/lib/auth";

export async function canEditCourse(session: SessionUser, courseId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "faculty") {
    // A faculty member can edit every subject they are assigned to (in any semester).
    const res = await query("SELECT 1 FROM courses WHERE id = $1 AND faculty_id = $2", [courseId, session.id]);
    return res.rows.length > 0;
  }
  if (session.role === "operations") {
    const res = await query(
      "SELECT 1 FROM permissions WHERE user_id = $1 AND course_id = $2 AND access_level = 'edit'",
      [session.id, courseId]
    );
    return res.rows.length > 0;
  }
  return false;
}

// Everyone who is logged in can view every course (students see all subjects
// for their batch; admin and faculty need no extra check here).
export function canViewCourse(session: SessionUser | null): boolean {
  return !!session;
}

// Which batches this person may see. Admin: any (null). Students: only their own
// batch. Faculty: only the batches of the subjects they teach. Looked up live, so
// if the admin moves a student or reassigns a subject it applies immediately.
export async function allowedBatchIds(session: SessionUser): Promise<string[] | null> {
  if (session.role === "admin" || session.role === "operations") return null;
  if (session.role === "student") {
    const res = await query("SELECT batch_id FROM student_roster WHERE id = $1", [session.studentId || session.id]);
    const b = res.rows[0]?.batch_id;
    return b ? [b] : [];
  }
  if (session.role === "faculty") {
    const res = await query(
      `SELECT c.batch_id, MIN(b.created_at) AS created FROM courses c JOIN batches b ON b.id = c.batch_id
       WHERE c.faculty_id = $1 GROUP BY c.batch_id ORDER BY created`,
      [session.id]
    );
    return res.rows.map((r) => r.batch_id);
  }
  return [];
}

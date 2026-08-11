import { query } from "@/lib/db";
import { SessionUser } from "@/lib/auth";

export async function canEditCourse(session: SessionUser, courseId: string): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "faculty") return session.courseId === courseId;
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

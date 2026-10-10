import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Admin: remove a faculty member's account. Only possible once none of their
// subjects remain assigned to them and they have no records in the portal.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ facultyId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { facultyId } = await params;

  const found = await query("SELECT id, name FROM users WHERE id = $1 AND role = 'faculty'", [facultyId]);
  if (found.rows.length === 0) return NextResponse.json({ error: "Faculty member not found." }, { status: 404 });
  const name = found.rows[0].name;

  const subjects = await query("SELECT COUNT(*)::int AS n FROM courses WHERE faculty_id = $1", [facultyId]);
  if (subjects.rows[0].n > 0) {
    return NextResponse.json({ error: `${name} still teaches ${subjects.rows[0].n} subject${subjects.rows[0].n > 1 ? "s" : ""}. Assign those subjects to someone else first (Semesters & subjects).` }, { status: 409 });
  }

  const payouts = await query("SELECT COUNT(*)::int AS n FROM faculty_sessions WHERE faculty_id = $1", [facultyId]);
  if (payouts.rows[0].n > 0) {
    return NextResponse.json({ error: `${name} has payout entries in Faculty payout, so the account can't be deleted without losing that history. To block access, set a new password instead.` }, { status: 409 });
  }

  try {
    await withTransaction(async (client) => {
      // The audit log keeps the person's name (actor_name); it just stops pointing at the deleted account.
      await client.query("UPDATE audit_log SET user_id = NULL WHERE user_id = $1", [facultyId]);
      await client.query("DELETE FROM permissions WHERE user_id = $1", [facultyId]);
      await client.query("DELETE FROM users WHERE id = $1", [facultyId]);
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23503") {
      return NextResponse.json({ error: `${name} has already recorded work in the portal (plans, attendance or marks), so the account can't be deleted without losing that history. To block access, set a new password instead.` }, { status: 409 });
    }
    throw err;
  }
  await logAudit(session.id, session.name, "users", facultyId, `Deleted faculty member ${name}`);
  return NextResponse.json({ ok: true });
}

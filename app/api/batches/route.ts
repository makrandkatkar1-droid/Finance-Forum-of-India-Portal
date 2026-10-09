import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allowedBatchIds } from "@/lib/authz";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const allowed = await allowedBatchIds(session);
  const res = allowed === null
    ? await query("SELECT id, name FROM batches ORDER BY created_at")
    : await query("SELECT id, name FROM batches WHERE id = ANY($1::uuid[]) ORDER BY created_at", [allowed]);
  return NextResponse.json({ batches: res.rows });
}

// Only the admin can add a batch. Every new batch starts with "Semester 1".
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { name } = await req.json();
  if (!name || !name.trim()) return NextResponse.json({ error: "name is required." }, { status: 400 });

  const res = await query("INSERT INTO batches (name) VALUES ($1) RETURNING id, name", [name.trim()]);
  await query(
    "INSERT INTO semesters (batch_id, name, semester_number, is_current) VALUES ($1, 'Semester 1', 1, true)",
    [res.rows[0].id]
  );
  await logAudit(session.id, session.name, "batches", res.rows[0].id, `Added a new batch: ${name.trim()}`);
  return NextResponse.json({ batch: res.rows[0] }, { status: 201 });
}

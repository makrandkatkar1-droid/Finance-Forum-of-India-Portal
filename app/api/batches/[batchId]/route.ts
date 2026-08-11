import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });
  const { batchId } = await params;
  const { name } = await req.json();

  const res = await query("UPDATE batches SET name = $1 WHERE id = $2 RETURNING id, name", [name, batchId]);
  if (res.rows.length === 0) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

  await logAudit(session.id, session.name, "batches", batchId, `Renamed batch to "${name}"`);
  return NextResponse.json({ batch: res.rows[0] });
}

import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const batchId = req.nextUrl.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId query param required." }, { status: 400 });

  const res = await query("SELECT category, token, inst1, inst2, inst3, inst4 FROM fee_plans WHERE batch_id = $1", [batchId]);
  return NextResponse.json({ plans: res.rows });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { batchId, category, field, value } = await req.json();
  if (!batchId || !category || !field) return NextResponse.json({ error: "batchId, category, and field are required." }, { status: 400 });
  if (!["token", "inst1", "inst2", "inst3", "inst4"].includes(field)) {
    return NextResponse.json({ error: "Invalid field." }, { status: 400 });
  }

  await query(
    `INSERT INTO fee_plans (batch_id, category, ${field}) VALUES ($1,$2,$3)
     ON CONFLICT (batch_id, category) DO UPDATE SET ${field} = EXCLUDED.${field}`,
    [batchId, category, value]
  );

  await logAudit(session.id, session.name, "fee_plans", null, `Updated ${field} for ${category} fee plan`);
  return NextResponse.json({ ok: true });
}

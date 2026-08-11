import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const batchId = req.nextUrl.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId query param required." }, { status: 400 });

  const res = await query(
    `SELECT sfp.student_roster_id, sfp.field, sfp.amount_paid
     FROM student_fee_payments sfp JOIN student_roster sr ON sr.id = sfp.student_roster_id
     WHERE sr.batch_id = $1`,
    [batchId]
  );
  return NextResponse.json({ payments: res.rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const { studentRosterId, field, amountPaid } = await req.json();
  if (!studentRosterId || !field) return NextResponse.json({ error: "studentRosterId and field are required." }, { status: 400 });
  if (!["token", "inst1", "inst2", "inst3", "inst4"].includes(field)) {
    return NextResponse.json({ error: "Invalid field." }, { status: 400 });
  }

  await query(
    `INSERT INTO student_fee_payments (student_roster_id, field, amount_paid, updated_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (student_roster_id, field) DO UPDATE SET amount_paid = EXCLUDED.amount_paid, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [studentRosterId, field, Math.max(0, Number(amountPaid) || 0), session.id]
  );

  await logAudit(session.id, session.name, "student_fee_payments", studentRosterId, `Recorded ${field} payment`);
  return NextResponse.json({ ok: true });
}

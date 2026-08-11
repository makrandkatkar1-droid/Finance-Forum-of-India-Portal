import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");

  const res = batchId
    ? await query("SELECT id, label, name, seat_number, username, batch_id, fee_category FROM student_roster WHERE batch_id = $1 ORDER BY seat_number", [batchId])
    : await query("SELECT id, label, name, seat_number, username, batch_id, fee_category FROM student_roster ORDER BY seat_number");

  return NextResponse.json({ students: res.rows });
}

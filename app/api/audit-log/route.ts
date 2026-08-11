import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Admin access only." }, { status: 403 });

  const res = await query(
    `SELECT id, actor_name, table_name, action, changed_at
     FROM audit_log ORDER BY changed_at DESC LIMIT 200`
  );

  return NextResponse.json({ log: res.rows });
}

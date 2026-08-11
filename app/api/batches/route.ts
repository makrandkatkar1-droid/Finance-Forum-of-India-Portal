import { NextRequest, NextResponse } from "next/server";
import { query, logAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const res = await query("SELECT id, name FROM batches ORDER BY created_at");
  return NextResponse.json({ batches: res.rows });
}

// Adding a batch is allowed pre-login too (matches the prototype's landing
// page "+ Add a new batch"), but renaming requires an admin session.
export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name || !name.trim()) return NextResponse.json({ error: "name is required." }, { status: 400 });

  const res = await query("INSERT INTO batches (name) VALUES ($1) RETURNING id, name", [name.trim()]);
  await logAudit(null, "Someone on the landing page", "batches", res.rows[0].id, `Added a new batch: ${name}`);
  return NextResponse.json({ batch: res.rows[0] }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const batchId = req.nextUrl.searchParams.get("batchId");

  const res = await query(
    `SELECT c.id, c.name, c.code, c.day_allocated, c.day_parity, c.total_hours, c.batch_id, c.results_published, u.name AS faculty_name
     FROM courses c JOIN users u ON u.id = c.faculty_id
     ${batchId ? "WHERE c.batch_id = $1" : ""}
     ORDER BY c.name`,
    batchId ? [batchId] : []
  );

  const courses = session.role === "faculty" ? res.rows.filter((c) => c.id === session.courseId) : res.rows;
  return NextResponse.json({ courses });
}

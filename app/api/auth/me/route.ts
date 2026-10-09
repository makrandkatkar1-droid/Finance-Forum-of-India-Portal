import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { allowedBatchIds } from "@/lib/authz";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null }, { status: 200 });
  // allowedBatchIds: null means "any batch" (admin). Students and faculty are
  // locked to the batches they belong to and cannot switch to another one.
  return NextResponse.json({ user: session, allowedBatchIds: await allowedBatchIds(session) });
}

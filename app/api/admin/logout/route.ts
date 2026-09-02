import { ADMIN_COOKIE } from "@/app/admin-auth";
import { cookies } from "next/headers";

export async function POST() {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}

import {
  ADMIN_COOKIE,
  createAdminSessionToken,
  isValidAdminPassword,
} from "@/app/admin-auth";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!body.password || !isValidAdminPassword(body.password))
    return Response.json({ error: "Incorrect admin passcode." }, { status: 401 });

  (await cookies()).set(ADMIN_COOKIE, createAdminSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return Response.json({ ok: true });
}

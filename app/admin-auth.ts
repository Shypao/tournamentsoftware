import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type AdminUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export const ADMIN_COOKIE = "redcourt_admin";

function sessionSecret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value && process.env.NODE_ENV === "production")
    throw new Error("ADMIN_SESSION_SECRET is not configured");
  return value ?? "redcourt-local-development-only";
}

export function createAdminSessionToken() {
  return createHmac("sha256", sessionSecret()).update("redcourt-admin").digest("hex");
}

export function isValidAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const suppliedHash = createHash("sha256").update(password).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export async function getAdminUser(): Promise<AdminUser | null> {
  if (process.env.NODE_ENV === "development") {
    return {
      userId: "local-development-admin",
      email: "",
      displayName: "Tournament Admin",
      fullName: "Tournament Admin",
    };
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const expected = createAdminSessionToken();
  const suppliedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) return null;
  return {
    userId: "tournament-admin",
    email: "",
    displayName: process.env.ADMIN_DISPLAY_NAME ?? "Tournament Admin",
    fullName: process.env.ADMIN_DISPLAY_NAME ?? "Tournament Admin",
  };
}

export async function requireAdminApiUser() {
  const user = await getAdminUser();
  if (!user)
    return {
      user: null,
      response: Response.json(
        { error: "Admin sign-in is required to manage this tournament." },
        { status: 401 },
      ),
    };
  return { user, response: null };
}

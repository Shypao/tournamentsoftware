import { getAdminUser } from "@/app/admin-auth";

export async function GET() {
  const user = await getAdminUser();
  return Response.json({ authenticated: Boolean(user), user });
}

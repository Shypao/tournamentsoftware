import { requireAdminApiUser } from "@/app/admin-auth";
import { resetTournamentStorage } from "@/db";
import { defaultTournamentOperations } from "@/lib/tournament-data";

export async function POST(request: Request) {
  const auth = await requireAdminApiUser();
  if (auth.response || !auth.user) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      confirmation?: unknown;
    };
    if (body.confirmation !== "RESET") {
      return Response.json(
        { error: "Reset confirmation is required." },
        { status: 400 },
      );
    }

    const version = await resetTournamentStorage(
      JSON.stringify(defaultTournamentOperations),
      auth.user.userId,
    );
    return Response.json({ ok: true, version });
  } catch (error) {
    console.error("Tournament reset failed", error);
    return Response.json(
      { error: "The tournament session could not be reset. Try again." },
      { status: 503 },
    );
  }
}

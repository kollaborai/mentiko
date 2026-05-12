import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// GET /api/chains - redirect to list endpoint for consistency
export async function GET() {
  // Redirect to the list endpoint which handles the actual chain listing
  return redirect("/api/chains/list");
}

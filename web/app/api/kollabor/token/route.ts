import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/api-auth";

// Session-gated engine endpoint discovery. The browser talks to a same-origin
// proxy; the proxy reads ~/.kollab/engine.token server-side.
export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    token: "proxied",
    baseUrl: "/api/kollabor/engine",
  });
}

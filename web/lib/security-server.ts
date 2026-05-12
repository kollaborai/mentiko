/**
 * Server-only security utilities — requires next/headers.
 * Import only from Server Components or Route Handlers, NOT client components.
 */
import { cookies } from "next/headers";
import { generateCsrfToken } from "./security";

const CSRF_COOKIE_NAME = "csrf-token";

export async function setCsrfCookie(): Promise<string> {
  const token = generateCsrfToken();
  const cookieStore = await cookies();
  cookieStore.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return token;
}

export async function getCsrfToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(CSRF_COOKIE_NAME)?.value;
}

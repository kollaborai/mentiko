// client-side hook for csrf token management

import { useState } from "react";

export function useCsrfToken() {
  // read from cookie in initializer to avoid synchronous setState in useEffect
  const [token] = useState<string | null>(() => {
    if (typeof document === "undefined") return null;
    const csrfFromCookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith("csrf-token="))
      ?.split("=")[1];
    return csrfFromCookie || null;
  });

  return token;
}

// wrapper for fetch with csrf token
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // get csrf token from cookie
  const csrfToken = document
    .cookie
    .split("; ")
    .find((row) => row.startsWith("csrf-token="))
    ?.split("=")[1];

  const headers = {
    ...options.headers,
    "Content-Type": "application/json",
    ...(csrfToken && { "X-CSRF-Token": csrfToken }),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

// for non-json requests (form data, etc)
export async function fetchWithCsrfFormData(
  url: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<Response> {
  const csrfToken = document
    .cookie
    .split("; ")
    .find((row) => row.startsWith("csrf-token="))
    ?.split("=")[1];

  const headers = {
    ...options.headers,
    ...(csrfToken && { "X-CSRF-Token": csrfToken }),
  };

  return fetch(url, {
    ...options,
    method: "POST",
    headers,
    body: formData,
  });
}

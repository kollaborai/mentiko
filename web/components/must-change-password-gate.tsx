"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

function buildLoginRedirect(pathname: string): string {
  if (typeof window === "undefined") {
    return `/login?redirect=${encodeURIComponent(pathname || "/dashboard")}`;
  }
  const redirectTo = `${pathname}${window.location.search}${window.location.hash}`;
  return `/login?redirect=${encodeURIComponent(redirectTo || "/dashboard")}`;
}

function SessionGateSplash({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MustChangePasswordGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const user = session?.user as { id?: string; mustChangePassword?: boolean } | undefined;
  const mustChangePassword = user?.mustChangePassword === true;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace(buildLoginRedirect(pathname));
      return;
    }
    if (!mustChangePassword) return;
    if (pathname.startsWith("/welcome/set-password")) return;
    router.replace("/welcome/set-password");
  }, [isPending, session, mustChangePassword, pathname, router]);

  if (isPending) {
    return <SessionGateSplash label="Checking session..." />;
  }
  if (!session) {
    return <SessionGateSplash label="Opening sign in..." />;
  }
  if (mustChangePassword) {
    return <SessionGateSplash label="Opening password setup..." />;
  }
  return <>{children}</>;
}

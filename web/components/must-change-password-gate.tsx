"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

export function MustChangePasswordGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) return;
    const user = session.user as { mustChangePassword?: boolean } | undefined;
    if (!user?.mustChangePassword) return;
    if (pathname.startsWith("/welcome/set-password")) return;
    router.replace("/welcome/set-password");
  }, [isPending, session, pathname, router]);

  return <>{children}</>;
}

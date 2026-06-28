"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth/auth-client";
import {
  ShieldTickFilled,
  TickCircleFilled,
  CloseCircleFilled,
  InfoCircleFilled,
  KeyFilled,
} from "@aliimam/icons";

type DeviceInfo = {
  user_code: string;
  client_label: string;
  scopes: string[];
  status: "pending" | "approved" | "denied" | "consumed";
  expired: boolean;
};

type InfoState = "idle" | "loading" | "loaded" | "notfound" | "needauth" | "error";

export default function McpAuthPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <LoadingCard />
        </Shell>
      }
    >
      <McpAuthFlow />
    </Suspense>
  );
}

function McpAuthFlow() {
  const { data: session, isPending: sessionPending } = useSession();
  const searchParams = useSearchParams();
  const code = (searchParams.get("code") || "").trim();
  const isUi = searchParams.get("ui") === "1";

  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [infoState, setInfoState] = useState<InfoState>("idle");
  const [infoError, setInfoError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [result, setResult] = useState<"approve" | "deny" | null>(null);

  // load what this device code is requesting (cookie-authed)
  useEffect(() => {
    if (!code || sessionPending || !session?.user) return;
    let cancelled = false;
    setInfoState("loading");
    fetch(`/api/mentiko-mcp/auth/device/info?code=${encodeURIComponent(code)}`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setInfoState("needauth");
          return;
        }
        if (res.status === 404) {
          setInfoState("notfound");
          return;
        }
        if (!res.ok) {
          let msg = "Something went wrong loading this request.";
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* ignore */
          }
          setInfoError(msg);
          setInfoState("error");
          return;
        }
        const data = (await res.json()) as DeviceInfo;
        if (cancelled) return;
        setInfo(data);
        setInfoState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setInfoError("Couldn't reach the server. Please try again.");
        setInfoState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [code, sessionPending, session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    async (decision: "approve" | "deny") => {
      if (!code || submitting) return;
      setSubmitting(true);
      setActionError("");
      try {
        // UI-control grants bind the window the user is approving from. The bar
        // persists its engine sessionId to localStorage (shared same-origin), so
        // read the most recent one and send it as the routing target.
        const body: Record<string, unknown> = { user_code: code, decision };
        if (decision === "approve" && isUi) {
          let target = "";
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith("mentiko-kollabor-session-id:")) {
                const val = localStorage.getItem(key);
                if (val) target = val;
              }
            }
          } catch {
            /* ignore */
          }
          body.target_session_id = target;
        }
        const res = await fetch("/api/mentiko-mcp/auth/device/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok) {
          setResult(decision);
        } else {
          setActionError((data && data.error) || "That didn't work. Please try again.");
        }
      } catch {
        setActionError("Couldn't reach the server. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [code, submitting, isUi],
  );

  return <Shell>{renderContent()}</Shell>;

  function renderContent(): ReactNode {
    // terminal states from a just-completed action take priority
    if (result === "approve") {
      return (
        <StateCard
          icon={<TickCircleFilled className="h-8 w-8 text-green-500" />}
          title="Connected"
        >
          You can return to your terminal.
        </StateCard>
      );
    }
    if (result === "deny") {
      return (
        <StateCard
          icon={<CloseCircleFilled className="h-8 w-8 text-muted-foreground" />}
          title="Request denied"
        >
          You can close this page.
        </StateCard>
      );
    }

    if (!code) {
      return (
        <StateCard
          icon={<InfoCircleFilled className="h-8 w-8 text-muted-foreground" />}
          title="Missing code"
        >
          This link doesn&apos;t include a device code. Open the link shown in your terminal again.
        </StateCard>
      );
    }

    if (sessionPending) {
      return <LoadingCard />;
    }

    if (!session?.user || infoState === "needauth") {
      const redirect = encodeURIComponent(`/mcp-auth?code=${code}`);
      return (
        <StateCard
          icon={<ShieldTickFilled className="h-8 w-8 text-primary" />}
          title="Sign in to continue"
        >
          You need to be signed in to approve this request.
          <Link
            href={`/login?redirect=${redirect}`}
            className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
        </StateCard>
      );
    }

    if (infoState === "idle" || infoState === "loading") {
      return <LoadingCard />;
    }

    if (infoState === "notfound") {
      return (
        <StateCard
          icon={<InfoCircleFilled className="h-8 w-8 text-muted-foreground" />}
          title="Code not found"
        >
          This code wasn&apos;t found. Double-check the code in your terminal and open the link again.
        </StateCard>
      );
    }

    if (infoState === "error" || !info) {
      return (
        <StateCard
          icon={<CloseCircleFilled className="h-8 w-8 text-destructive" />}
          title="Something went wrong"
        >
          {infoError || "Please try again."}
        </StateCard>
      );
    }

    // info loaded — terminal if expired or no longer pending
    if (info.expired || info.status !== "pending") {
      return (
        <StateCard
          icon={<InfoCircleFilled className="h-8 w-8 text-muted-foreground" />}
          title="Nothing to do here"
        >
          This request has already been handled or expired.
        </StateCard>
      );
    }

    // pending — the approval card
    return (
      <Card>
        <Brand />
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-muted">
            <ShieldTickFilled className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">Authorize Mentiko access</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{info.client_label}</span> wants to connect to your Mentiko account.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Confirm this code matches your terminal
          </p>
          <div className="rounded-md bg-muted px-4 py-3 text-center">
            <span className="font-mono text-lg font-semibold tracking-[0.3em] text-foreground">
              {info.user_code}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <KeyFilled className="h-3.5 w-3.5" />
            <span>Access being granted</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {info.scopes.length === 0 ? (
              <span className="text-xs text-muted-foreground">No specific scopes requested.</span>
            ) : (
              info.scopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                >
                  {scope}
                </span>
              ))
            )}
          </div>
        </div>

        {actionError && (
          <p className="mt-4 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">{actionError}</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => submit("deny")}
            disabled={submitting}
            className="w-full rounded-md bg-muted py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => submit("approve")}
            disabled={submitting}
            className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/50"
          >
            {submitting ? "Approving..." : "Approve"}
          </button>
        </div>
      </Card>
    );
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-foreground/10 bg-card p-6">{children}</div>;
}

function Brand() {
  return (
    <div className="mb-5 flex items-center justify-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-6 w-6">
        <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white" />
        <path
          d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z"
          fill="#0a0a0a"
        />
      </svg>
      <span className="font-mono text-sm font-black tracking-tight">mentiko</span>
    </div>
  );
}

function LoadingCard() {
  return (
    <Card>
      <Brand />
      <div className="flex flex-col items-center py-4 text-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
        <p className="mt-3 text-xs text-muted-foreground">Checking your request…</p>
      </div>
    </Card>
  );
}

function StateCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <Brand />
      <div className="flex flex-col items-center text-center">
        <div className="mb-3">{icon}</div>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {children && (
          <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
        )}
      </div>
    </Card>
  );
}

/**
 * @jest-environment jsdom
 */

// mock ESM-only deps BEFORE importing the component
jest.mock("@dicebear/core", () => ({}));
jest.mock("@dicebear/bottts-neutral", () => ({}));

import React from "react";
import { render, screen } from "@testing-library/react";
import { AgentProfileBadge } from "@/components/agent/agent-status-panel";
import type { AgentProfile } from "@/lib/types";

// simple Badge mock
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

jest.mock("@/components/ui/copy-button", () => ({
  CopyButton: () => null,
}));

jest.mock("@/components/status-badge", () => ({
  StatusBadge: () => null,
}));

jest.mock("@aliimam/icons", () => ({
  BotMessageSquare: () => null,
  ArrowDown2Filled: () => null,
  ArrowRight2Filled: () => null,
  ClockFilled: () => null,
  RotateRightFilled: () => null,
  DocumentTextFilled: () => null,
  ShieldTickFilled: () => null,
  FolderOpenFilled: () => null,
  MessageSquareFilled: () => null,
}));

jest.mock("@/lib/use-agent-profiles", () => ({
  useAgentProfiles: () => [],
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const makeProfile = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "claude-sonnet",
  name: "Claude / Sonnet",
  cli: "claude",
  isDefault: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("AgentProfileBadge", () => {
  it("shows profile name when chain default resolves", () => {
    const profiles = [makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", isDefault: true })];
    render(<AgentProfileBadge chainDefaultProfileId="claude-sonnet" profiles={profiles} />);
    expect(screen.getByText("Claude / Sonnet")).toBeInTheDocument();
  });

  it("shows profile not found when configured id is invalid", () => {
    const profiles = [makeProfile({ id: "claude-sonnet", isDefault: true })];
    render(<AgentProfileBadge chainDefaultProfileId="missing-profile" profiles={profiles} />);
    expect(screen.getByText("profile not found")).toBeInTheDocument();
    expect(screen.getByText(/missing-profile/)).toBeInTheDocument();
  });

  it("shows no profile when no id configured and no default exists", () => {
    const profiles = [makeProfile({ id: "claude-sonnet", isDefault: false })];
    render(<AgentProfileBadge profiles={profiles} />);
    expect(screen.getByText("no profile")).toBeInTheDocument();
  });

  it("falls back to namespace default when no id configured", () => {
    const profiles = [makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", isDefault: true })];
    render(<AgentProfileBadge profiles={profiles} />);
    expect(screen.getByText("Claude / Sonnet")).toBeInTheDocument();
  });

  it("uses workspace default before namespace default", () => {
    const profiles = [
      makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", isDefault: true }),
      makeProfile({ id: "kollab", name: "Kollab / Mentiko", cli: "kollab", isDefault: false }),
    ];

    render(<AgentProfileBadge workspaceDefaultProfileId="kollab" profiles={profiles} />);

    expect(screen.getByText("Kollab / Mentiko")).toBeInTheDocument();
    expect(screen.getByText("workspace default")).toBeInTheDocument();
    expect(screen.queryByText("Claude / Sonnet")).not.toBeInTheDocument();
  });

  it("chain default takes priority over workspace default", () => {
    const profiles = [
      makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", isDefault: false }),
      makeProfile({ id: "kollab", name: "Kollab / Mentiko", cli: "kollab", isDefault: true }),
    ];

    render(
      <AgentProfileBadge
        chainDefaultProfileId="claude-sonnet"
        workspaceDefaultProfileId="kollab"
        profiles={profiles}
      />
    );

    expect(screen.getByText("Claude / Sonnet")).toBeInTheDocument();
    expect(screen.getByText("chain default")).toBeInTheDocument();
    expect(screen.queryByText("workspace default")).not.toBeInTheDocument();
  });

  it("runtime profile takes priority over saved chain and workspace defaults", () => {
    const profiles = [
      makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", isDefault: false }),
      makeProfile({ id: "kollab", name: "Kollab / Mentiko", cli: "kollab", isDefault: true }),
      makeProfile({ id: "codex-default", name: "Codex / Default", cli: "codex", isDefault: false }),
    ];

    render(
      <AgentProfileBadge
        runtimeProfileId="codex-default"
        chainDefaultProfileId="claude-sonnet"
        workspaceDefaultProfileId="kollab"
        profiles={profiles}
      />
    );

    expect(screen.getByText("Codex / Default")).toBeInTheDocument();
    expect(screen.getByText("run profile")).toBeInTheDocument();
    expect(screen.queryByText("Claude / Sonnet")).not.toBeInTheDocument();
  });

  it("shows profile not found for invalid agent-level override", () => {
    const profiles = [makeProfile({ id: "claude-sonnet", isDefault: true })];
    render(<AgentProfileBadge agentProfileId="bogus-id" profiles={profiles} />);
    expect(screen.getByText("profile not found")).toBeInTheDocument();
    expect(screen.getByText(/bogus-id/)).toBeInTheDocument();
  });

  it("agent override takes priority over chain default", () => {
    const profiles = [
      makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet" }),
      makeProfile({ id: "codex-default", name: "Codex / Default", cli: "codex" }),
    ];
    render(
      <AgentProfileBadge
        agentProfileId="codex-default"
        chainDefaultProfileId="claude-sonnet"
        profiles={profiles}
      />
    );
    expect(screen.getByText("Codex / Default")).toBeInTheDocument();
    expect(screen.queryByText("Claude / Sonnet")).not.toBeInTheDocument();
  });

  it("shows no profile when profiles array is empty", () => {
    render(<AgentProfileBadge profiles={[]} />);
    expect(screen.getByText("no profile")).toBeInTheDocument();
  });
});

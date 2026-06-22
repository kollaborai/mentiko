/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DecisionDetail } from "../decision-detail";
import type { Decision } from "@/lib/decisions/decision-types";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@aliimam/icons", () => ({
  ArrowLeftFilled: ({ className }: { className?: string }) => <svg className={className} />,
  TrashFilled: ({ className }: { className?: string }) => <svg className={className} />,
  SendFilled: ({ className }: { className?: string }) => <svg className={className} />,
  RefreshFilled: ({ className }: { className?: string }) => <svg className={className} />,
  BookFilled: ({ className }: { className?: string }) => <svg className={className} />,
  NextFilled: ({ className }: { className?: string }) => <svg className={className} />,
  TaskSquareFilled: ({ className }: { className?: string }) => <svg className={className} />,
}));

jest.mock("@aliimam/vectors", () => ({
  Abstract65Shapes: ({ className }: { className?: string }) => <svg className={className} />,
}), { virtual: true });

jest.mock("../guided-flow-shell", () => ({
  GuidedFlowShell: () => <div data-testid="guided-flow-shell" />,
}), { virtual: true });

jest.mock("@/components/guided-flow/guided-flow-shell", () => ({
  GuidedFlowShell: () => <div data-testid="guided-flow-shell" />,
}));

jest.mock("../briefing-carousel", () => ({
  BriefingCarousel: () => <div data-testid="briefing-carousel" />,
}));

jest.mock("../verdict-card", () => ({
  VerdictCard: () => <div data-testid="verdict-card" />,
}));

jest.mock("../overview-tab", () => ({
  OverviewTab: () => <div data-testid="overview-tab" />,
}));

jest.mock("../options-tab", () => ({
  OptionsTab: () => <div data-testid="options-tab" />,
}));

jest.mock("../context-tab", () => ({
  ContextTab: () => <div data-testid="context-tab" />,
}));

jest.mock("../history-tab", () => ({
  HistoryTab: () => <div data-testid="history-tab" />,
}));

jest.mock("../approval-bar", () => ({
  ApprovalBar: () => <div data-testid="approval-bar" />,
}));

jest.mock("../decision-shared", () => ({
  statusBadge: (status: string) => <span>{status}</span>,
  priorityBadge: (priority?: string) => <span>{priority}</span>,
  confidenceTone: () => "text-foreground",
  inferBlastRadius: () => "low",
  formatDate: (value: string) => value,
  DetailSecondaryButton: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const approvedDecision: Decision = {
  id: "decision-1",
  status: "approved",
  prompt: "Pick implementation plan",
  title: "Pick implementation plan",
  priority: "medium",
  category: "product",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T01:00:00.000Z",
  options: [
    {
      id: "opt-a",
      letter: "A",
      name: "Plan A",
      description: "Do it",
      pros: [],
      cons: [],
      effort: "medium",
      risk: "low",
    },
  ],
  recommendation: {
    choiceId: "opt-a",
    rationale: "Best fit",
    confidence: "high",
  },
  resolution: {
    selectedOptionId: "opt-a",
    selectedBy: "user",
    selectedAt: "2026-06-22T01:00:00.000Z",
    taskId: "EPIC-009",
  },
};

describe("DecisionDetail", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          decision: approvedDecision,
        },
      }),
    });
  });

  it("uses the embedded open-task callback instead of navigating", async () => {
    const onOpenTask = jest.fn();
    render(
      <DecisionDetail
        decisionId="decision-1"
        workspacePath="/repo"
        onOpenTask={onOpenTask}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /open task/i }));

    await waitFor(() => {
      expect(onOpenTask).toHaveBeenCalledWith("EPIC-009");
    });
  });
});

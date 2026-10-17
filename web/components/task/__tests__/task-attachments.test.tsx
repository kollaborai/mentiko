/**
 * TaskAttachments component tests (FEAT-001/TASK-006).
 * Mocks fetch at the boundary; proves list rendering, human sizes,
 * quiet zero-state, error chips from envelope messages, and the img URLs.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskAttachments, humanAttachmentSize } from "../task-attachments";
import type { TaskAttachment } from "@/lib/tasks/task-attachment-types";

function attachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: "tka-1",
    taskId: "TASK-1",
    orgId: "default",
    originalFilename: "screenshot.png",
    storedFilename: "tka-1.png",
    contentType: "image/png",
    size: 2400,
    checksum: "x",
    status: "stored",
    createdAt: "2026-10-17T10:30:00.000Z",
    createdBy: "user-1",
    ...overrides,
  };
}

function okBody(list: TaskAttachment[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { attachments: list } }),
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("humanAttachmentSize", () => {
  it("formats bytes, KB, MB", () => {
    expect(humanAttachmentSize(0)).toBe("0 B");
    expect(humanAttachmentSize(512)).toBe("512 B");
    expect(humanAttachmentSize(2400)).toBe("2.3 KB");
    expect(humanAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("TaskAttachments", () => {
  it("renders filename, human size, timestamp, and the bytes-route img URL", async () => {
    fetchMock.mockResolvedValue(okBody([attachment()]));
    render(<TaskAttachments taskId="TASK-1" />);

    await waitFor(() => expect(screen.getByTitle("screenshot.png")).toBeInTheDocument());
    expect(screen.getByAltText("screenshot.png")).toHaveAttribute(
      "src",
      "/api/tasks/TASK-1/attachments/tka-1",
    );
    expect(screen.getByText(/2\.3 KB/)).toBeInTheDocument();
    expect(screen.getByText(/10\/17\/2026|2026/)).toBeInTheDocument();
    expect(screen.queryByTestId("attachments-empty")).not.toBeInTheDocument();
  });

  it("shows a quiet zero-state when the task has no attachments", async () => {
    fetchMock.mockResolvedValue(okBody([]));
    render(<TaskAttachments taskId="TASK-1" />);

    await waitFor(() => expect(screen.getByTestId("attachments-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("task-attachment-card")).not.toBeInTheDocument();
  });

  it("surfaces a list-load failure as a STATUS_PILL error chip", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: "boom" } }),
    });
    render(<TaskAttachments taskId="TASK-1" />);

    await waitFor(() => expect(screen.getByTestId("attachments-load-error")).toBeInTheDocument());
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

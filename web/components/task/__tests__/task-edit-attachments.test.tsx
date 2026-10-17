/**
 * TASK-006 edit-dialog attachment tests.
 * The edit dialog uploads against the EXISTING task id -- no ordering
 * constraint, but rejection chips must still surface, and the picker feeds
 * the same endpoint.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskEditDialog } from "../task-edit-dialog";
import type { Task } from "@/lib/tasks/task-types";

const mockFetch = jest.fn();

function makeTask(): Task {
  return {
    id: "TASK-E1",
    title: "Existing task",
    description: "",
    type: "task",
    priority: 2,
    rawPriority: 2,
    status: "open",
    createdAt: "2026-10-17T00:00:00.000Z",
    assignee: "",
  } as unknown as Task;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  // default: empty attachment list
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: { method?: string }) => {
    if (init?.method === "POST") {
      return {
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: { attachment: { id: "tka-9" } } }),
      } as unknown as Response;
    }
    if (String(input).endsWith("/attachments") && !init?.method) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { attachments: [] } }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    } as unknown as Response;
  });
});

describe("TaskEditDialog attachments (TASK-006)", () => {
  it("renders the editable attachment section with picker, paste zone, and empty state", async () => {
    render(
      <TaskEditDialog
        task={makeTask()}
        open
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("attachment-picker-button")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("attachment-paste-zone")).toBeInTheDocument();
    expect(screen.getByTestId("task-attachment-input")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("attachments-empty")).toBeInTheDocument(),
    );
  });

  it("uploads a picked image against the existing task id via the same endpoint", async () => {
    const user = userEvent.setup();
    render(
      <TaskEditDialog
        task={makeTask()}
        open
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("attachment-picker-button")).toBeInTheDocument(),
    );
    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    await user.upload(input, new File(["bytes"], "edit-shot.png", { type: "image/png" }));

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(
        (c) => String(c[0]) === "/api/tasks/TASK-E1/attachments" && c[1]?.method === "POST",
      );
      expect(calls).toHaveLength(1);
    });
    const call = mockFetch.mock.calls.find(
      (c) => String(c[0]) === "/api/tasks/TASK-E1/attachments" && c[1]?.method === "POST",
    );
    const form = call![1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("edit-shot.png");
  });

  it("surfaces a rejected upload as a visible STATUS_PILL error chip", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: { method?: string }) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          status: 415,
          json: async () => ({
            success: false,
            error: {
              message: "file content does not match its declared type",
              details: { reason: "mime_mismatch" },
            },
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { attachments: [] } }),
      } as unknown as Response;
    });

    render(
      <TaskEditDialog
        task={makeTask()}
        open
        onClose={() => {}}
        onSave={async () => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("attachment-picker-button")).toBeInTheDocument(),
    );
    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    await user.upload(input, new File(["bytes"], "tricky.png", { type: "image/png" }));

    await waitFor(() =>
      expect(screen.getByTestId("attachment-error-chips")).toBeInTheDocument(),
    );
    expect(screen.getByText(/mime_mismatch/i)).toBeInTheDocument();
  });
});

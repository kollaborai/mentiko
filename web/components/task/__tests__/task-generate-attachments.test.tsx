/**
 * TASK-006 create-dialog attachment staging tests.
 *
 * Proves the ORDERING CONTRACT: attachments upload only AFTER
 * POST /api/tasks/create resolves with a task id, and rejected uploads
 * surface as visible error chips while the task itself stays created.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskGenerateDialog } from "../task-generate-dialog";

const mockFetchWithNamespace = jest.fn();
const mockPush = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

function makeFile(name: string, type = "image/png"): File {
  return new File(["fake-bytes"], name, { type });
}

const createOrder: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  createOrder.length = 0;

  // global fetch = the attachment upload calls the dialog never makes first
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    createOrder.push(String(input));
    return {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: { attachment: { id: "tka-1" } },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  // namespace fetch = POST /api/tasks/create
  mockFetchWithNamespace.mockImplementation(async (path: string, init?: { method?: string }) => {
    createOrder.push(`${init?.method || "GET"} ${path}`);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: { issue: { id: "TASK-NEW-1" } },
      }),
    };
  });
});

async function openManualMode(user: ReturnType<typeof userEvent.setup>) {
  render(
    <TaskGenerateDialog
      open
      onClose={() => {}}
      onCreate={async () => "TASK-NEW-1"}
      initialMode="manual"
    />,
  );
  // switch Method to Manual
  await user.click(screen.getByRole("button", { name: /manual/i }));
  await waitFor(() =>
    expect(screen.getByTestId("attachment-paste-zone")).toBeInTheDocument(),
  );
}

async function typePrompt(user: ReturnType<typeof userEvent.setup>) {
  // handleManualCreate guards on prompt text; first line is the title
  await user.type(screen.getByRole("textbox"), "Build the thing\nwith detail");
}

describe("TaskGenerateDialog attachment staging (TASK-006)", () => {
  it("stages picked files and shows the upload-after-create hint", async () => {
    const user = userEvent.setup();
    await openManualMode(user);

    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    await user.upload(input, makeFile("spec.png"));

    await waitFor(() =>
      expect(screen.getByText(/will upload after create/i)).toBeInTheDocument(),
    );
    // nothing has been uploaded yet: no attachment call before task creation
    expect(createOrder.filter((c) => c.includes("attachments"))).toHaveLength(0);
  });

  it("rejects a non-image pick immediately with a visible chip", async () => {
    const user = userEvent.setup();
    await openManualMode(user);

    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    // fireEvent bypasses userEvent's accept-attr filtering, simulating a
    // drag-dropped or forced pick of a disallowed type
    fireEvent.change(input, { target: { files: [makeFile("notes.txt", "text/plain")] } });

    await waitFor(() =>
      expect(screen.getByTestId("attachment-error-chips")).toBeInTheDocument(),
    );
    expect(screen.getByText(/unsupported image type/i)).toBeInTheDocument();
    expect(createOrder.filter((c) => c.includes("attachments"))).toHaveLength(0);
  });

  it("uploads staged files only after the task create call resolves", async () => {
    const user = userEvent.setup();

    // onCreate stands in for the page's POST /api/tasks/create; record its
    // position relative to the attachment upload calls in the shared order log
    const onCreate = jest.fn(async () => {
      createOrder.push("CREATE-RESOLVED");
      return "TASK-NEW-1";
    });

    render(
      <TaskGenerateDialog
        open
        onClose={() => {}}
        onCreate={onCreate}
        initialMode="manual"
      />,
    );
    await user.click(screen.getByRole("button", { name: /manual/i }));
    await waitFor(() =>
      expect(screen.getByTestId("attachment-paste-zone")).toBeInTheDocument(),
    );

    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    await user.upload(input, makeFile("shot.png"));
    await typePrompt(user);

    await user.click(screen.getByRole("button", { name: /^create/i }));

    await waitFor(() =>
      expect(
        createOrder.some((c) => c.includes("/api/tasks/TASK-NEW-1/attachments")),
      ).toBe(true),
    );

    const createIdx = createOrder.indexOf("CREATE-RESOLVED");
    const uploadIdx = createOrder.findIndex((c) => c.includes("/api/tasks/TASK-NEW-1/attachments"));
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(createIdx);
  });

  it("keeps the dialog open with failure chips when an upload is rejected", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 413,
      json: async () => ({
        success: false,
        error: { message: "file exceeds maximum size", details: { reason: "file_too_large" } },
      }),
    })) as unknown as typeof fetch;

    render(
      <TaskGenerateDialog
        open
        onClose={() => {}}
        onCreate={async () => "TASK-NEW-1"}
        initialMode="manual"
      />,
    );
    await user.click(screen.getByRole("button", { name: /manual/i }));

    const input = screen.getByTestId("task-attachment-input") as HTMLInputElement;
    await user.upload(input, makeFile("huge.png"));
    await typePrompt(user);
    await user.click(screen.getByRole("button", { name: /^create/i }));

    await waitFor(() =>
      expect(screen.getByTestId("attachment-error-chips")).toBeInTheDocument(),
    );
    expect(screen.getByText(/file_too_large/i)).toBeInTheDocument();
    // dialog stays open (still mounted) with the stager visible
    expect(screen.getByTestId("attachment-paste-zone")).toBeInTheDocument();
    // staged file was consumed
    expect(screen.queryByText(/will upload after create/i)).not.toBeInTheDocument();
  });
});

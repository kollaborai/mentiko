import { render, screen, waitFor } from "@testing-library/react";
import { MustChangePasswordGate } from "../must-change-password-gate";

const mockReplace = jest.fn();
let mockPathname = "/dashboard";
let mockSession: { user: { id?: string; mustChangePassword?: boolean } } | null = null;
let mockIsPending = false;

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/lib/auth/auth-client", () => ({
  useSession: () => ({ data: mockSession, isPending: mockIsPending }),
}));

describe("MustChangePasswordGate", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPathname = "/dashboard";
    mockSession = null;
    mockIsPending = false;
    sessionStorage.clear();
    window.history.pushState({}, "", "/dashboard");
  });

  it("holds protected UI while the session is loading", () => {
    mockIsPending = true;

    render(
      <MustChangePasswordGate>
        <div>dashboard widgets</div>
      </MustChangePasswordGate>,
    );

    expect(screen.getByText("Checking session...")).toBeInTheDocument();
    expect(screen.queryByText("dashboard widgets")).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects missing sessions to login before rendering protected widgets", async () => {
    window.history.pushState({}, "", "/dashboard?tab=runs#latest");

    render(
      <MustChangePasswordGate>
        <div>dashboard widgets</div>
      </MustChangePasswordGate>,
    );

    expect(screen.getByText("Opening sign in...")).toBeInTheDocument();
    expect(screen.queryByText("dashboard widgets")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/login?redirect=%2Fdashboard%3Ftab%3Druns%23latest",
      );
    });
  });

  it("redirects temporary-password users to password setup", async () => {
    mockSession = { user: { id: "user-1", mustChangePassword: true } };

    render(
      <MustChangePasswordGate>
        <div>dashboard widgets</div>
      </MustChangePasswordGate>,
    );

    expect(screen.getByText("Opening password setup...")).toBeInTheDocument();
    expect(screen.queryByText("dashboard widgets")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/welcome/set-password");
    });
  });

  it("renders protected UI after a fresh session no longer needs setup", () => {
    mockSession = { user: { id: "user-1", mustChangePassword: false } };

    render(
      <MustChangePasswordGate>
        <div>dashboard widgets</div>
      </MustChangePasswordGate>,
    );

    expect(screen.getByText("dashboard widgets")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

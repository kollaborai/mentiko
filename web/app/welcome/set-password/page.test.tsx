import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { authClient } from "@/lib/auth-client";
import { hardReplace } from "@/lib/browser-navigation";
import WelcomeSetPasswordPage from "./page";

jest.mock("@/lib/auth-client", () => ({
  authClient: {
    changePassword: jest.fn(),
  },
}));

jest.mock("@/lib/browser-navigation", () => ({
  hardReplace: jest.fn(),
}));

const mockChangePassword = authClient.changePassword as jest.Mock;
const mockHardReplace = hardReplace as jest.Mock;

describe("WelcomeSetPasswordPage", () => {
  beforeEach(() => {
    mockChangePassword.mockReset();
    mockHardReplace.mockReset();
    global.fetch = jest.fn();
  });

  it("clears the server flag and hard reloads to dashboard after password setup", async () => {
    mockChangePassword.mockResolvedValue({});
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    render(<WelcomeSetPasswordPage />);

    const inputs = document.querySelectorAll<HTMLInputElement>("input[type='password']");
    fireEvent.change(inputs[0], {
      target: { value: "temporary-password" },
    });
    fireEvent.change(inputs[1], {
      target: { value: "new-password-123" },
    });
    fireEvent.change(inputs[2], {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: "temporary-password",
        newPassword: "new-password-123",
        revokeOtherSessions: false,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/account/finish-password-setup",
        { method: "POST" },
      );
      expect(mockHardReplace).toHaveBeenCalledWith("/dashboard");
    });
  });
});

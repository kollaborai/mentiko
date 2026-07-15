import { copyToClipboardWithResult } from "@/lib/ui/copy-to-clipboard";

describe("copyToClipboardWithResult", () => {
  const writeText = jest.fn<Promise<void>, [string]>();
  const execCommand = jest.fn<boolean, [string]>();

  beforeEach(() => {
    writeText.mockReset();
    execCommand.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
  });

  it("uses the Clipboard API and reports success after the write resolves", async () => {
    writeText.mockResolvedValue();

    await expect(copyToClipboardWithResult("shape json")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("shape json");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    execCommand.mockReturnValue(true);

    await expect(copyToClipboardWithResult("shape json")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when neither clipboard path succeeds", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    execCommand.mockReturnValue(false);

    await expect(copyToClipboardWithResult("shape json")).resolves.toBe(false);
  });
});

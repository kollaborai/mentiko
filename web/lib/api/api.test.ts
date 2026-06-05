import { chainsApi } from "./api";

describe("chainsApi.status", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          data: { chain: { id: "chain-1", name: "Chain 1" } },
          requestId: "req_test",
        }),
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("requests a specific chain status by id", async () => {
    await chainsApi.status("chain-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chains/status?id=chain-1",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("can request expanded agent definitions", async () => {
    await chainsApi.status("chain-1", { expand: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chains/status?id=chain-1&expand=true",
      expect.any(Object)
    );
  });
});

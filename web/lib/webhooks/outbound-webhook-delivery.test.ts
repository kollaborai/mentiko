jest.mock("dns", () => ({
  lookup: jest.fn(),
}));

import { lookup as dnsLookup } from "dns";

const lookupMock = dnsLookup as unknown as jest.Mock;

describe("outbound webhook delivery lookup", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("blocks private targets returned through the all:true array lookup path", async () => {
    const { safeOutboundWebhookLookup } = await import("./outbound-webhook-delivery");

    lookupMock.mockImplementation((_hostname, _options, callback) => {
      callback(null, [
        { address: "198.51.100.10", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ], undefined);
    });

    await new Promise<void>((resolve) => {
      safeOutboundWebhookLookup("hooks.example.test", { all: true }, (error) => {
        expect(error?.message).toMatch(/private/i);
        resolve();
      });
    });
  });

  it("allows public targets returned through the all:true array lookup path", async () => {
    const { safeOutboundWebhookLookup } = await import("./outbound-webhook-delivery");

    lookupMock.mockImplementation((_hostname, _options, callback) => {
      callback(null, [
        { address: "198.51.100.10", family: 4 },
        { address: "2001:db8::10", family: 6 },
      ], undefined);
    });

    await new Promise<void>((resolve) => {
      safeOutboundWebhookLookup("hooks.example.test", { all: true }, (error, address) => {
        expect(error).toBeNull();
        expect(Array.isArray(address)).toBe(true);
        resolve();
      });
    });
  });
});

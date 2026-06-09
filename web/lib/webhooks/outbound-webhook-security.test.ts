describe("outbound webhook security", () => {
  it("rejects IPv4-mapped IPv6 private targets", async () => {
    const security = await import("./outbound-webhook-security");

    expect(security.normalizeOutboundWebhookUrl("http://[::ffff:127.0.0.1]/")).toBeUndefined();
    expect(security.normalizeOutboundWebhookUrl("http://[::ffff:169.254.169.254]/")).toBeUndefined();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const security = await import("./outbound-webhook-security");

    await expect(security.assertSafeOutboundWebhookTarget(
      "https://hooks.example.test/webhook",
      async () => [{ address: "169.254.169.254", family: 4 }]
    )).rejects.toThrow(/private/i);
  });

  it("identifies redirects as blocked outbound delivery responses", async () => {
    const security = await import("./outbound-webhook-security");

    expect(security.isRedirectStatus(301)).toBe(true);
    expect(security.isRedirectStatus(302)).toBe(true);
    expect(security.isRedirectStatus(307)).toBe(true);
    expect(security.isRedirectStatus(202)).toBe(false);
  });
});

const mockSendMail = jest.fn().mockResolvedValue({});
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock("nodemailer", () => ({
  createTransport: mockCreateTransport,
}));

describe("sendEmail", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reads authenticated SMTP env at send time", async () => {
    const { sendEmail } = await import("../email/email");

    process.env.SMTP_HOST = "74.207.252.96";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "mk-user";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_FROM = "mentiko-help@marco.mentiko.com";

    await expect(sendEmail({
      to: "admin@mentiko.com",
      subject: "Reset your password",
      text: "reset",
      html: "<p>reset</p>",
    })).resolves.toBe(true);

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "74.207.252.96",
      port: 587,
      secure: false,
      auth: { user: "mk-user", pass: "secret" },
    });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "mentiko-help@marco.mentiko.com",
      to: "admin@mentiko.com",
    }));
  });

  it("supports unauthenticated relay mode for tenant-hosted email", async () => {
    const { sendEmail } = await import("../email/email");

    process.env.SMTP_HOST = "74.207.252.96";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM = "mentiko-help@marco.mentiko.com";

    await sendEmail({
      to: "admin@mentiko.com",
      subject: "Reset your password",
      text: "reset",
      html: "<p>reset</p>",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "74.207.252.96",
      port: 587,
      secure: false,
    });
  });

  it("allows transactional callers to override the from address", async () => {
    const { sendEmail } = await import("../email/email");

    process.env.SMTP_HOST = "74.207.252.96";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM = "noreply@marco.mentiko.com";

    await sendEmail({
      to: "admin@mentiko.com",
      subject: "Reset your password",
      text: "reset",
      html: "<p>reset</p>",
      from: "Mentiko Help <mentiko-help@marco.mentiko.com>",
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "Mentiko Help <mentiko-help@marco.mentiko.com>",
    }));
  });
});

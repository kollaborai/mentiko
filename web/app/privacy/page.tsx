import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Mentiko",
  description: "Privacy policy for Mentiko, the AI agent orchestration platform.",
};

export default function PrivacyPage() {
  const updated = "March 7, 2026";
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back</Link>
        </div>
        <h1 className="text-2xl font-black mb-2 tracking-tighter">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {updated}</p>

        <div className="space-y-8 text-foreground/80 text-sm leading-relaxed">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">1. Who We Are</h2>
            <p>Mentiko, Inc. operates the Mentiko platform at mentiko.com. Contact: <a href="mailto:support@mentiko.com" className="text-primary hover:underline">support@mentiko.com</a></p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">2. Data We Collect</h2>
            <p className="mb-2">When you use Mentiko we collect:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Account data:</strong> email address, name, and hashed password (if email signup)</li>
              <li><strong className="text-foreground">OAuth data:</strong> name, email, and profile picture from your OAuth provider if you sign in with GitHub, Google, or Microsoft</li>
              <li><strong className="text-foreground">Usage data:</strong> chain runs, agent execution logs, timestamps, and session metadata</li>
              <li><strong className="text-foreground">Technical data:</strong> IP address, browser type, and error logs for debugging</li>
              <li><strong className="text-foreground">Payment data:</strong> billing details processed by Stripe (we never see raw card numbers)</li>
              <li><strong className="text-foreground">Cookies:</strong> session cookies for authentication. No tracking or advertising cookies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">3. How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and improve the Service</li>
              <li>To authenticate you and maintain your session</li>
              <li>To process payments and manage subscriptions</li>
              <li>To send transactional emails (account verification, password reset, billing)</li>
              <li>To investigate abuse or security incidents</li>
              <li>To comply with legal obligations</li>
            </ul>
            <p className="mt-2">We do not sell your data. We do not use your data to train AI models without explicit consent.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">4. Data Storage & Security</h2>
            <p>Your data is stored on the infrastructure configured by your Mentiko operator. Mentiko supports PostgreSQL with encrypted connections, WAL-mode SQLite for auth data, and TLS in transit. We use reasonable security measures but cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">5. Sub-Processors</h2>
            <p className="mb-2">We use the following third-party services:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Hosting provider:</strong> Cloud hosting and object storage configured by your operator</li>
              <li><strong className="text-foreground">Stripe:</strong> Payment processing and subscription management (US)</li>
              <li><strong className="text-foreground">GitHub:</strong> OAuth sign-in (US)</li>
              <li><strong className="text-foreground">Google:</strong> OAuth sign-in (US)</li>
              <li><strong className="text-foreground">Microsoft:</strong> OAuth sign-in (US)</li>
              <li><strong className="text-foreground">Namecheap / Titan:</strong> Transactional email delivery (US)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>We retain your account data as long as your account is active. Run logs and agent outputs are retained for 90 days by default. After account deletion, data is removed within 30 days from production systems and within 90 days from backups.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">7. Your Rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Access:</strong> Request a copy of your data</li>
              <li><strong className="text-foreground">Correction:</strong> Update inaccurate data in your account settings</li>
              <li><strong className="text-foreground">Deletion:</strong> Delete your account and data (GDPR Art. 17). See <Link href="/settings" className="text-primary hover:underline">account settings</Link> or email us.</li>
              <li><strong className="text-foreground">Portability:</strong> Export your chains and data in JSON format</li>
              <li><strong className="text-foreground">Objection:</strong> Object to processing for marketing purposes (we don&apos;t do marketing email without consent)</li>
            </ul>
            <p className="mt-2">To exercise these rights, email <a href="mailto:support@mentiko.com" className="text-primary hover:underline">support@mentiko.com</a></p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">8. Cookies</h2>
            <p>We use only necessary cookies:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><code className="text-xs bg-muted px-1 py-0.5 rounded">better-auth.session_token</code> — authentication session (httpOnly, secure on HTTPS)</li>
            </ul>
            <p className="mt-2">No analytics cookies, no advertising pixels, no third-party tracking.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">9. Children</h2>
            <p>The Service is not directed at children under 16. We do not knowingly collect data from minors. If you believe a minor has an account, contact us immediately.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">10. Changes</h2>
            <p>We will notify you of material changes to this policy by email at least 30 days before they take effect.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">11. Contact & DPA</h2>
            <p>Privacy questions: <a href="mailto:support@mentiko.com" className="text-primary hover:underline">support@mentiko.com</a></p>
            <p className="mt-1">Enterprise customers requiring a Data Processing Agreement (DPA) should contact us directly.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-foreground/10 flex gap-6 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
        </div>
      </div>
    </div>
  );
}

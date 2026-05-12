import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Mentiko",
  description: "Terms of service for Mentiko, the AI agent orchestration platform.",
};

export default function TermsPage() {
  const updated = "March 7, 2026";
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back</Link>
        </div>
        <h1 className="text-2xl font-black mb-2 tracking-tighter">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {updated} &mdash; <span className="text-amber-400">Beta terms. Subject to revision before GA.</span></p>

        <div className="prose prose-sm max-w-none space-y-8 text-foreground/80">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">1. Acceptance</h2>
            <p>By creating an account or using Mentiko (&ldquo;Service&rdquo;, operated by Mentiko, Inc.), you agree to these Terms. If you don&apos;t agree, don&apos;t use the Service.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">2. Service Description</h2>
            <p>Mentiko is an AI agent orchestration platform that lets you define, run, and monitor chains of AI agents. The Service is provided on an as-is basis during the beta period.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">3. Accounts</h2>
            <p>You must provide accurate information when creating an account. You are responsible for all activity under your account. Notify us immediately at <a href="mailto:support@mentiko.com" className="text-primary hover:underline">support@mentiko.com</a> if you suspect unauthorized access.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">4. Acceptable Use</h2>
            <p>You may not use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Violate any law or third-party rights</li>
              <li>Generate, distribute, or facilitate spam, malware, or phishing</li>
              <li>Attempt to gain unauthorized access to systems or data</li>
              <li>Reverse-engineer, copy, or resell the Service</li>
              <li>Use the Service to train competing AI models without written consent</li>
              <li>Conduct denial-of-service attacks or abuse API rate limits</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">5. Your Data & Intellectual Property</h2>
            <p>You own your chains, agent definitions, and outputs. You grant Mentiko a limited license to process and store your data solely to provide the Service. We do not claim ownership of anything you create.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">6. Service Availability</h2>
            <p>We aim for high availability but make no guarantees. During the beta period, the Service may be unavailable, slow, or subject to data loss. We recommend maintaining your own backups of important chain definitions.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">7. Termination</h2>
            <p>You may cancel your account at any time. We may suspend or terminate accounts that violate these Terms. Upon termination, you have 30 days to export your data before it is deleted.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">8. Disclaimer of Warranties</h2>
            <p>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">9. Limitation of Liability</h2>
            <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, MENTIKO SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA OR PROFITS. OUR TOTAL LIABILITY IS LIMITED TO THE AMOUNT YOU PAID IN THE PAST 12 MONTHS, OR $100 USD, WHICHEVER IS LESS.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">10. Changes to Terms</h2>
            <p>We may update these Terms. We will notify registered users by email for material changes. Continued use after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">11. Governing Law</h2>
            <p>These Terms are governed by the laws of the State of California, USA, without regard to conflict of law provisions.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">12. Contact</h2>
            <p>Questions? Email <a href="mailto:support@mentiko.com" className="text-primary hover:underline">support@mentiko.com</a></p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-foreground/10 flex gap-6 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
        </div>
      </div>
    </div>
  );
}

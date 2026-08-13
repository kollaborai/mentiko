---
name: mentiko-user-docs
description: Maintain Mentiko's in-app documentation and product updates. Use for changes to `/docs`, `/updates`, release notes, changelog cards, documentation links, or user-facing feature documentation in the public Mentiko platform.
---

# Mentiko user docs and updates

Use this skill for the documentation users see inside Mentiko. It covers the
in-app `/docs` knowledge base and the `/updates` product-update feed. It does
not turn implementation notes, local runbooks, CI activity, or repo markdown
into customer-facing copy by default.

## Start with source truth

- Read `AGENTS.md`, `web/AGENTS.md`, and `REPO_BOUNDARY.md`.
- Use the codebase-memory graph to locate the implemented route, API, store,
  or runtime contract before documenting it. Source and live behavior outrank
  plans, task comments, old release entries, and assumptions.
- Verify the actual UI when it is available. The development surface is
  `https://devv.mentiko.com/docs` and `https://devv.mentiko.com/updates`.
  A successful build does not prove a route, link, copy change, or behavior is
  visible to a user.
- Keep private control-plane details, real infrastructure, credentials, and
  customer-specific information out of this public repository.

## Canonical surfaces

In-app documentation:

- Individual docs pages: `web/app/docs/**/page.tsx`
- Docs landing-page cards and search corpus: `web/app/docs/page.tsx`
- Docs sidebar navigation: `web/app/docs/layout.tsx`
- Implementation-backed docs assertions: `web/app/docs/docs-contract.test.ts`
- Repository reference material when the user specifically needs it:
  `docs/**` and `.kdex/articles/**`

Product updates:

- User-facing update data and visible-update version: `web/lib/releases.ts`
- Full feed renderer: `web/app/updates/page.tsx`
- Dashboard preview: `web/components/dashboard/updates-widget.tsx`
- Build-tag invariant: `CURRENT_RELEASE_VERSION` in `web/lib/releases.ts`
- Build-tag guard: `web/lib/__tests__/release-version-guard.test.ts`

`CURRENT_RELEASE_VERSION` must match every tagged platform release. The
`releases` array is separate: it is the user-facing update feed, so it may
remain unchanged for an internal-only release. `LATEST_VERSION` deliberately
tracks the newest visible update card, not the newest internal build.

## Decide docs and updates independently

Evaluate every product change on two separate questions:

1. Does a user need durable instructions, reference material, setup guidance,
   changed defaults, an API contract, or troubleshooting help? If yes, update
   the relevant `/docs` page even when no update card is warranted.
2. Does a user need to know that the product now does something new, behaves
   materially differently, no longer fails in a way they can experience, or
   requires action? If yes, add or revise one concise `/updates` card.

Do not make the docs page and update card repeat one another. The update says
what changed and why it matters; the docs page explains how it works.

## Development-stage update policy

No customers does not make `/updates` an engineering diary. In development,
write for a person evaluating or operating the current preview build.

Add an update only when at least one of these is true:

- A person can use a new capability or see a meaningful UI/workflow change.
- A released or preview-user workflow now succeeds, becomes more reliable, or
  produces a materially different result.
- A user needs to change configuration, permissions, data, or habits.
- A compatibility, migration, security, privacy, or availability change has a
  practical user consequence.

Do not add an update for any of these by themselves:

- Refactors, tests, logging, cleanup, code organization, or developer tools.
- CI, Docker/image, build-memory, package-path, smoke-test, or release-pipeline
  work that users cannot observe or depend on.
- A bug found only by the development team before the affected behavior reached
  a preview user.
- A list of low-level fixes when one outcome-focused reliability note would be
  enough for users.

Use this test before writing: if the change cannot honestly start with
"You can now...", "Mentiko now...", or "This no longer..." from a user's
point of view, leave it out of `/updates`.

For a group of related user-facing fixes, write one short outcome-based card.
Describe the changed experience, not function names, shell flags, source paths,
CI symptoms, or the debugging story. Use `new`, `improvement`, `fix`, and
`security` accurately. Do not make a security claim more specific than the
verified remediation allows.

## Editing in-app docs

- Update the exact topic page first. Never claim a route, endpoint, setting,
  schema, default, or sequence exists until it is proven in implementation or
  the live app.
- For a new topic, update both the landing-page card/search corpus and the
  sidebar navigation. Existing pages in one registry but not the other are a
  discoverability bug, not a reason to add a third registry.
- Sweep related docs pages, API reference, examples, command snippets,
  troubleshooting guidance, and links when a contract changes.
- Add or update a focused contract test whenever a page documents an API
  method, data path, CLI form, or another fact that can drift silently.
- Keep copy task-oriented, concrete, and implementation-agnostic unless the
  implementation detail is necessary for the user to operate the product.

## Editing product updates

- Add a card at the top of `releases` only after it passes the relevance test.
- Use the actual release tag for a user-facing card. Do not invent a card just
  to satisfy a version check; update `CURRENT_RELEASE_VERSION` for every tag.
- Set `docsHref` to the most useful real destination: a relevant `/docs` page
  when it exists, otherwise the affected product route. Never link a card to a
  nonexistent docs route or a generic page that cannot help the reader.
- The full feed and dashboard widget share the same data. Check both after
  changing `releases` so the three newest cards remain understandable in the
  compact dashboard preview.
- Do not rewrite historical entries merely to make the feed sound newer. Fix a
  bad destination, false statement, or material user harm only with evidence.

## Verification

Run the smallest relevant checks from `web/`:

```bash
npm test -- --runInBand app/docs/docs-contract.test.ts lib/__tests__/release-version-guard.test.ts
```

Then verify the strongest applicable live surface:

- Open `/docs` and the changed docs route. Confirm the index/search card and
  sidebar entry if the topic is new or moved.
- Open `/updates`. Confirm title, category, date, version, relevance, and the
  destination of every changed `docsHref`; a 404 is a failed docs update.
- Check the dashboard update preview when its first three entries can change.
- For layout work, check 390px and 820px. For content-only work, check the
  normal signed-in view and say if responsive verification was not needed.

Report the implemented source, exact user-facing routes checked, tests run,
and anything still unverified. Do not call docs current because their source
compiled; the user-visible route is the completion proof.

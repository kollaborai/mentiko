# Existing Workspace Reattach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user picks a folder that already matches an existing workspace, the setup flow should surface
an inline choice to reattach the existing workspace or create a second workspace from the same folder.

**Architecture:** Keep the logic inside the existing local-folder setup step so the UX stays inline with the create
flow. Load the current workspace list once, compare the selected folder path against registered workspace paths,
and swap the create button area for a duplicate-aware panel when a match exists. Reattach should reuse the
existing workspace record; create-another should create a new workspace row with a unique name.

**Tech Stack:** React 19, Next.js client components, `useNamespaceFetch`, `@testing-library/react`, Jest.

---

### Task 1: Add duplicate-folder detection coverage

**Files:**
- Modify: `web/components/onboarding/project-setup/project-setup-defaults.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the existing-workspace panel when the selected folder already matches a workspace path", async () => {
  mockFetchWithNamespace.mockImplementation(async (url: string) => {
    if (url === "/api/workspaces") {
      return jsonResponse({
        workspaces: [
          {
            id: "mentiko",
            name: "mentiko",
            path: "/Users/test/workspaces",
            addedAt: "2026-07-02T00:00:00.000Z",
          },
        ],
      });
    }
    return jsonResponse({});
  });

  render(
    <ProjectSetupStep
      onComplete={jest.fn()}
      onBack={jest.fn()}
      onSkip={jest.fn()}
      workspacesDir="/Users/test/workspaces"
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /use an existing folder/i }));

  expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /reattach existing/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /create another instance/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /create workspace/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- web/components/onboarding/project-setup/project-setup-defaults.test.tsx`
Expected: fail because the local-folder setup does not yet fetch registered workspaces or render the duplicate panel.

- [ ] **Step 3: Commit the test-only baseline if needed**

```bash
git add web/components/onboarding/project-setup/project-setup-defaults.test.tsx
git commit -m "test: cover duplicate workspace folder setup"
```

### Task 2: Implement duplicate-aware local-folder setup

**Files:**
- Modify: `web/components/onboarding/project-setup/local-folder-setup.tsx`
- Modify: `web/components/onboarding/steps/project-setup-step.tsx` only if the panel needs a new callback shape

- [ ] **Step 1: Implement the smallest change to pass the test**

```tsx
// Load the workspace list once, compare selectedPath to registered paths, and
// render a compact warning panel with reattach / create-another actions.
```

- [ ] **Step 2: Run the focused test again**

Run: `npm test -- web/components/onboarding/project-setup/project-setup-defaults.test.tsx`
Expected: pass.

- [ ] **Step 3: Verify the current workspace page still renders**

Run: `npm test -- web/app/workspaces/page.test.tsx`
Expected: pass.

### Task 3: Browser verify the selection flow

**Files:**
- None

- [ ] **Step 1: Open `/workspaces` in the in-app browser and select a known folder**
- [ ] **Step 2: Confirm the inline duplicate panel appears for an existing path**
- [ ] **Step 3: Confirm reattach and create-another actions are visible and clickable**


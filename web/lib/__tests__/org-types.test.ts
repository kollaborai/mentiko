import { canRolePerformAction } from "../org-types";

describe("org-types RBAC", () => {
  it("allows owner to perform view_audit", () => {
    expect(canRolePerformAction("owner", "view_audit")).toBe(true);
  });

  it("allows admin to perform view_audit", () => {
    expect(canRolePerformAction("admin", "view_audit")).toBe(true);
  });

  it("denies member from view_audit", () => {
    expect(canRolePerformAction("member", "view_audit")).toBe(false);
  });

  it("denies guest from view_audit", () => {
    expect(canRolePerformAction("guest", "view_audit")).toBe(false);
  });
});

/**
 * auth-permissions unit tests.
 * mocks better-auth's createAccessControl to avoid ESM import issues in jest.
 */

// mock better-auth's ESM module
jest.mock("better-auth/plugins/access", () => {
  const createAccessControl = (resources: Record<string, string[]>) => {
    const ac = {
      resources,
      newRole: (statements: Record<string, string[]>) => ({
        statements,
      }),
    };
    return ac;
  };
  return { createAccessControl };
});

import { ac, owner, admin, member, guest } from "../auth-permissions";

describe("auth-permissions", () => {
  describe("access control statement", () => {
    it("exports ac with newRole method", () => {
      expect(ac).toBeDefined();
      expect(typeof ac.newRole).toBe("function");
    });
  });

  describe("owner role", () => {
    it("has full access including settings", () => {
      expect(owner.statements.settings).toContain("manage");
      expect(owner.statements.organization).toContain("delete");
      expect(owner.statements.member).toContain("delete");
    });
  });

  describe("admin role", () => {
    it("can update org but not delete", () => {
      expect(admin.statements.organization).toContain("update");
      expect(admin.statements.organization).not.toContain("delete");
    });

    it("cannot manage settings", () => {
      expect(admin.statements.settings).toEqual([]);
    });

    it("can manage chains and tasks", () => {
      expect(admin.statements.chain).toContain("create");
      expect(admin.statements.chain).toContain("delete");
      expect(admin.statements.task).toContain("update");
    });
  });

  describe("member role", () => {
    it("cannot manage org or members", () => {
      expect(member.statements.organization).toEqual([]);
      expect(member.statements.member).toEqual([]);
    });

    it("can manage chains and tasks", () => {
      expect(member.statements.chain).toContain("create");
      expect(member.statements.task).toContain("view");
    });

    it("can create invitations", () => {
      expect(member.statements.invitation).toContain("create");
    });
  });

  describe("guest role", () => {
    it("has view-only access to chains and tasks", () => {
      expect(guest.statements.chain).toEqual(["view"]);
      expect(guest.statements.task).toEqual(["view"]);
    });

    it("cannot manage anything", () => {
      expect(guest.statements.organization).toEqual([]);
      expect(guest.statements.member).toEqual([]);
      expect(guest.statements.invitation).toEqual([]);
      expect(guest.statements.settings).toEqual([]);
    });
  });

  describe("role hierarchy", () => {
    it("all four roles are defined and distinct", () => {
      const roles = [owner, admin, member, guest];
      const unique = new Set(roles);
      expect(unique.size).toBe(4);
    });

    it("owner has superset of admin permissions", () => {
      const adminStmts = admin.statements as Record<string, string[]>;
      const ownerStmts = owner.statements as Record<string, string[]>;
      for (const resource of Object.keys(adminStmts)) {
        for (const action of adminStmts[resource]) {
          expect(ownerStmts[resource]).toContain(action);
        }
      }
    });
  });
});

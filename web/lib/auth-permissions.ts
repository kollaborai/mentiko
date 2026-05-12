/**
 * auth-permissions: access control definitions for Better Auth organization plugin.
 * maps to existing OrgRole/OrgAction types from org-types.ts.
 */

import { createAccessControl } from "better-auth/plugins/access";

const statement = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  chain: ["create", "view", "update", "delete"],
  task: ["create", "view", "update", "delete"],
  settings: ["manage"],
});

export const owner = statement.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  chain: ["create", "view", "update", "delete"],
  task: ["create", "view", "update", "delete"],
  settings: ["manage"],
});

export const admin = statement.newRole({
  organization: ["update"],
  member: ["create", "update"],
  invitation: ["create", "cancel"],
  chain: ["create", "view", "update", "delete"],
  task: ["create", "view", "update", "delete"],
  settings: [],
});

export const member = statement.newRole({
  organization: [],
  member: [],
  invitation: ["create"],
  chain: ["create", "view", "update", "delete"],
  task: ["create", "view", "update", "delete"],
  settings: [],
});

export const guest = statement.newRole({
  organization: [],
  member: [],
  invitation: [],
  chain: ["view"],
  task: ["view"],
  settings: [],
});

export const ac = statement;

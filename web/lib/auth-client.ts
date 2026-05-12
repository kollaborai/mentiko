/**
 * auth-client: Better Auth client hooks for React.
 * provides useSession, signIn, signUp, signOut, and organization hooks.
 *
 * when NEXT_PUBLIC_MOCK_OAUTH=true, adds genericOAuth client plugin
 * for mock OAuth provider testing.
 */

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { ac, owner, admin, member, guest } from "./auth-permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugins: any[] = [
  organizationClient({
    ac,
    roles: { owner, admin, member, guest },
  }),
  genericOAuthClient(),
];

const _authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  plugins,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = _authClient as any;

// export as any to allow access to plugin-added methods (oauth2, organization, etc)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authClient: any = _authClient;

export const useSession = client.useSession;
export const signIn = client.signIn;
export const signUp = client.signUp;
export const signOut = client.signOut;
export const useActiveOrganization = client.useActiveOrganization;
export const useListOrganizations = client.useListOrganizations;

/**
 * true when mock OAuth is enabled (for login page to use correct sign-in method)
 */
export const isMockOAuth = process.env.NEXT_PUBLIC_MOCK_OAUTH === "true";

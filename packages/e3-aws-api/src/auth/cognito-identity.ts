/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cognito Identity Integration
 *
 * Extracts identity from API Gateway JWT authorizer claims.
 * Admin status is determined by the e3:is_admin claim set by the
 * Pre-Token Generation Lambda for federated users.
 */

import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Identity, WhoamiBackend } from '@elaraai/e3-admin-core';

/** Cognito group name for native (non-federated) admin users */
const COGNITO_ADMIN_GROUP = 'e3-admins';

/**
 * API Gateway event with JWT authorizer claims.
 */
export interface APIGatewayEventWithJWT {
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
}

/**
 * Check if user is admin from JWT claims.
 *
 * For federated users: checks e3:is_admin claim (set by Pre-Token Generation Lambda)
 * For native users: checks cognito:groups for e3-admins membership
 */
function isAdminFromClaims(claims: Record<string, unknown>): boolean {
  // Check e3:is_admin claim (federated users via Pre-Token Generation Lambda)
  if (claims['e3:is_admin'] === 'true') {
    return true;
  }

  // Fallback: check cognito:groups (native Cognito users)
  const groups = claims['cognito:groups'];
  if (Array.isArray(groups)) {
    return groups.includes(COGNITO_ADMIN_GROUP);
  }

  return false;
}

/**
 * Extract identity from API Gateway JWT authorizer claims.
 */
export function extractIdentity(event: APIGatewayEventWithJWT): Identity | null {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) return null;

  return {
    sub: claims.sub as string,
    email: claims.email as string | undefined,
    name: claims.name as string | undefined,
    isAdmin: isAdminFromClaims(claims),
  };
}

/**
 * WhoamiBackend implementation for Cognito.
 */
export class CognitoWhoamiBackend implements WhoamiBackend {
  getIdentity(requestContext: unknown): Identity | null {
    return extractIdentity(requestContext as APIGatewayEventWithJWT);
  }
}

/**
 * User information returned from Cognito lookup.
 */
export interface CognitoUser {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Look up a user in Cognito by email address.
 *
 * Used when adding users to repositories by email - we need to resolve
 * the email to a Cognito sub (user ID) for ACL storage.
 */
export async function lookupUserByEmail(
  email: string,
  userPoolId: string = process.env.USER_POOL_ID!
): Promise<CognitoUser | null> {
  const client = new CognitoIdentityProviderClient({});
  const result = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email}"`,
    Limit: 1,
  }));

  const user = result.Users?.[0];
  if (!user) return null;

  const attrs = Object.fromEntries(
    user.Attributes?.map(a => [a.Name, a.Value]) ?? []
  );

  return {
    sub: attrs.sub,
    email: attrs.email,
    name: attrs.name,
  };
}

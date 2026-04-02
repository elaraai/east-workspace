/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Pre-Token Generation Lambda Trigger (V2)
 *
 * This Lambda is triggered by Cognito before generating tokens. It reads
 * IdP groups from user attributes (mapped during federation) and sets
 * the e3:is_admin claim based on group membership.
 *
 * Flow:
 * 1. User authenticates via EntraID (or other OIDC IdP)
 * 2. EntraID sends groups in the token (as GUIDs)
 * 3. Cognito OIDC federation maps groups to custom:groups attribute
 * 4. This Lambda checks if user is in admin group, sets e3:is_admin claim
 * 5. API reads e3:is_admin from token for authorization decisions
 *
 * Environment variables:
 * - ADMIN_GROUP: The IdP group identifier (GUID) that grants admin access
 */

import type {
  PreTokenGenerationV2TriggerEvent,
  PreTokenGenerationV2TriggerHandler,
} from 'aws-lambda';

/**
 * Parse groups from user attributes.
 *
 * EntraID sends groups as a JSON array string of GUIDs:
 * '["b1de3e14-4420-4920-a673-c9da23562da4", "679ca78f-2ed5-4ee6-a9e6-d69f115b9c51"]'
 */
function parseGroups(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((g): g is string => typeof g === 'string');
      }
    } catch {
      // Fall back to comma-separated
      return value.split(',').map(g => g.trim()).filter(g => g.length > 0);
    }
  }
  if (Array.isArray(value)) {
    return value.filter((g): g is string => typeof g === 'string');
  }
  return [];
}

/**
 * Pre-Token Generation V2 handler.
 *
 * Checks if user is in the admin group and sets the e3:is_admin claim.
 * Requires LambdaVersion V2_0 for access token customization.
 *
 * Supports both:
 * - Federated users (OIDC): groups come from custom:groups attribute
 * - Native Cognito users: groups come from groupConfiguration.groupsToOverride
 */
/* eslint-disable @typescript-eslint/require-await -- Cognito Lambda triggers require async handlers */
export const handler: PreTokenGenerationV2TriggerHandler = async (
  event: PreTokenGenerationV2TriggerEvent
): Promise<PreTokenGenerationV2TriggerEvent> => {
/* eslint-enable @typescript-eslint/require-await */
  const adminGroup = process.env.ADMIN_GROUP;

  // Read IdP groups from user attributes (mapped during OIDC federation)
  const idpGroupsAttr = event.request.userAttributes['custom:groups'];
  const idpGroups = idpGroupsAttr ? parseGroups(idpGroupsAttr) : [];

  // Also read native Cognito groups (for non-federated users)
  // These come from groupConfiguration.groupsToOverride
  const cognitoGroups = event.request.groupConfiguration?.groupsToOverride ?? [];

  // Combine both group sources
  const allGroups = [...idpGroups, ...cognitoGroups];

  // Check if user is in the admin group
  // For federated users: adminGroup is the IdP group ID (GUID)
  // For native users: check if they're in the 'e3-admins' Cognito group
  const isAdmin = adminGroup
    ? allGroups.includes(adminGroup) || cognitoGroups.includes('e3-admins')
    : cognitoGroups.includes('e3-admins');

  // Get email from user attributes for access token (not included by default)
  const email = event.request.userAttributes.email;

  // Set claims on access and ID tokens
  // - e3:is_admin: admin status for authorization
  // - email: user's email (needed for /api/whoami, not in access token by default)
  event.response.claimsAndScopeOverrideDetails = {
    accessTokenGeneration: {
      claimsToAddOrOverride: {
        'e3:is_admin': isAdmin ? 'true' : 'false',
        ...(email ? { email } : {}),
      },
    },
    idTokenGeneration: {
      claimsToAddOrOverride: {
        'e3:is_admin': isAdmin ? 'true' : 'false',
      },
    },
  };

  return event;
};

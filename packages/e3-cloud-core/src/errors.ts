/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Error classes for e3 admin core operations.
 */

import type { AuthzErrorCode } from '@elaraai/e3-cloud-types';

/**
 * Base error for admin core operations.
 */
export class AdminCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * User not found in identity provider.
 */
export class UserNotFoundError extends AdminCoreError {
  constructor(public readonly email: string) {
    super(`User not found: ${email}`);
  }
}

/**
 * Repository not found.
 */
export class RepoNotFoundError extends AdminCoreError {
  constructor(public readonly repo: string) {
    super(`Repository not found: ${repo}`);
  }
}

/**
 * Map AuthzErrorCode to HTTP status code.
 */
export function errorCodeToStatus(code: AuthzErrorCode): number {
  switch (code.type) {
    case 'unauthorized': return 401;
    case 'forbidden': return 403;
    case 'last_owner': return 400;
    case 'user_not_found': return 404;
  }
}

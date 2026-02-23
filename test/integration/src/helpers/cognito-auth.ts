/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cognito Test User Authentication Helper
 *
 * Authenticates test users programmatically using USER_PASSWORD_AUTH flow.
 * Retrieves passwords from Secrets Manager and returns valid tokens.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Test user identifiers (matches e3-cloud-tests TestUserId type).
 */
export type TestUserId = 'owner' | 'member' | 'outsider' | 'admin';

/**
 * Authentication result from Cognito.
 */
export interface AuthResult {
  /** JWT access token for API authentication */
  accessToken: string;
  /** User's Cognito sub (unique identifier) */
  sub: string;
  /** User's email address */
  email: string;
  /** JWT ID token */
  idToken: string;
  /** Token expiration time */
  expiresIn: number;
}

/**
 * Configuration for CognitoTestAuth.
 */
export interface CognitoTestAuthConfig {
  /** Cognito User Pool ID */
  userPoolId: string;
  /** Cognito User Pool Client ID */
  clientId: string;
  /** ARN of Secrets Manager secret containing test user passwords */
  secretArn: string;
  /** Email domain for test users */
  emailDomain?: string;
  /** AWS region */
  region?: string;
}

/**
 * Decoded JWT payload (partial - only fields we need).
 */
interface JwtPayload {
  sub: string;
  email?: string;
  'cognito:username'?: string;
  exp?: number;
}

/**
 * Decode a JWT token without verification (for extracting claims).
 */
function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const payload = parts[1];
  const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(decoded) as JwtPayload;
}

/**
 * Cognito Test User Authentication Helper.
 *
 * Authenticates test users using USER_PASSWORD_AUTH flow.
 * Passwords are retrieved from Secrets Manager (populated by CDK deployment).
 *
 * Usage:
 * ```typescript
 * const auth = new CognitoTestAuth({
 *   userPoolId: outputs.userPoolId,
 *   clientId: outputs.userPoolClientId,
 *   secretArn: outputs.testUserSecretArn,
 * });
 *
 * const ownerAuth = await auth.authenticate('owner');
 * console.log(ownerAuth.accessToken, ownerAuth.sub, ownerAuth.email);
 * ```
 */
export class CognitoTestAuth {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly secrets: SecretsManagerClient;
  private readonly config: Required<CognitoTestAuthConfig>;

  /** Cached passwords from Secrets Manager */
  private passwordCache: Record<TestUserId, string> | null = null;

  /** Cached authentication results (tokens) */
  private authCache: Map<TestUserId, AuthResult> = new Map();

  /** In-flight authentication promises (deduplicates concurrent calls) */
  private authPending: Map<TestUserId, Promise<AuthResult>> = new Map();

  constructor(config: CognitoTestAuthConfig) {
    const region = config.region ?? process.env.AWS_REGION ?? 'ap-southeast-2';

    this.config = {
      ...config,
      emailDomain: config.emailDomain ?? 'test.elaraai.com',
      region,
    };

    this.cognito = new CognitoIdentityProviderClient({ region });
    this.secrets = new SecretsManagerClient({ region });
  }

  /**
   * Authenticate a test user and return tokens + identity info.
   *
   * Results are cached - subsequent calls for the same user return cached tokens
   * unless they've expired.
   *
   * @param userId - Test user identifier ('owner', 'member', 'outsider', 'admin')
   * @returns Authentication result with tokens and identity info
   */
  async authenticate(userId: TestUserId): Promise<AuthResult> {
    // Check cache
    const cached = this.authCache.get(userId);
    if (cached) {
      // Check if token is still valid (with 5 minute buffer)
      const payload = decodeJwt(cached.accessToken);
      const expiresAt = (payload.exp ?? 0) * 1000;
      if (expiresAt > Date.now() + 5 * 60 * 1000) {
        return cached;
      }
      // Token expired or expiring soon, clear cache entry
      this.authCache.delete(userId);
    }

    // Deduplicate concurrent requests for the same user
    const pending = this.authPending.get(userId);
    if (pending) return pending;

    const promise = this.authenticateImpl(userId);
    this.authPending.set(userId, promise);
    try {
      return await promise;
    } finally {
      this.authPending.delete(userId);
    }
  }

  private async authenticateImpl(userId: TestUserId): Promise<AuthResult> {
    // Get password from Secrets Manager
    const password = await this.getPassword(userId);
    const email = `${userId}@${this.config.emailDomain}`;

    // Authenticate with Cognito using USER_PASSWORD_AUTH
    const authResponse = await this.cognito.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.config.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }));

    const result = authResponse.AuthenticationResult;
    if (!result?.AccessToken || !result?.IdToken) {
      throw new Error(`Authentication failed for ${userId}: no tokens returned`);
    }

    // Decode ID token to get sub and email
    const idPayload = decodeJwt(result.IdToken);
    const sub = idPayload.sub;
    const tokenEmail = idPayload.email ?? email;

    if (!sub) {
      throw new Error(`Authentication failed for ${userId}: no sub in ID token`);
    }

    const authResult: AuthResult = {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      sub,
      email: tokenEmail,
      expiresIn: result.ExpiresIn ?? 3600,
    };

    // Cache the result
    this.authCache.set(userId, authResult);

    return authResult;
  }

  /**
   * Get password for a test user from Secrets Manager.
   * Passwords are cached after first retrieval.
   */
  private async getPassword(userId: TestUserId): Promise<string> {
    if (!this.passwordCache) {
      const response = await this.secrets.send(new GetSecretValueCommand({
        SecretId: this.config.secretArn,
      }));

      if (!response.SecretString) {
        throw new Error('Test user secret is empty');
      }

      this.passwordCache = JSON.parse(response.SecretString) as Record<TestUserId, string>;
    }

    const password = this.passwordCache[userId];
    if (!password) {
      throw new Error(`No password found for test user '${userId}'`);
    }

    return password;
  }

  /**
   * Clear cached passwords and tokens.
   * Call this if you need to re-authenticate all users.
   */
  clearCache(): void {
    this.passwordCache = null;
    this.authCache.clear();
  }
}

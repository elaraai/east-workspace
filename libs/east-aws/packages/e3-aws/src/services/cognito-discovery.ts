/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * OIDC Discovery Endpoint
 *
 * Returns OpenID Connect discovery document that tells the CLI:
 * - Where to start device flow (/oauth2/device_authorization)
 * - Where to exchange tokens (/oauth2/token)
 * - Where to get public keys (Cognito's JWKS)
 */

import { Hono } from 'hono';

/**
 * Create OIDC discovery routes.
 *
 * The discovery endpoint points to our Lambda's device flow proxy endpoints
 * for authentication, while using Cognito's JWKS for token validation.
 */
export function createDiscoveryRoutes() {
  const app = new Hono();

  app.get('/.well-known/openid-configuration', (c) => {
    const cognitoIssuer = process.env.COGNITO_ISSUER!;

    // Get the base URL - prefer BASE_URL env var if set (custom domain),
    // otherwise construct from request headers (CloudFront domain)
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      const proto = c.req.header('x-forwarded-proto') ?? 'https';
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
      baseUrl = `${proto}://${host}`;
    }

    return c.json({
      // Issuer is Cognito (for token validation)
      issuer: cognitoIssuer,

      // Device flow endpoints - our Lambda handles these
      device_authorization_endpoint: `${baseUrl}/oauth2/device_authorization`,
      token_endpoint: `${baseUrl}/oauth2/token`,

      // JWKS from Cognito (for token validation)
      jwks_uri: `${cognitoIssuer}/.well-known/jwks.json`,

      // Supported capabilities
      response_types_supported: ['code', 'token'],
      grant_types_supported: [
        'authorization_code',
        'urn:ietf:params:oauth:grant-type:device_code',
        'refresh_token',
      ],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['none'],

      // Scopes
      scopes_supported: ['openid', 'email', 'profile'],
    });
  });

  return app;
}

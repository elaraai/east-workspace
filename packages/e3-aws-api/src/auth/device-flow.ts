/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * OAuth 2.0 Device Authorization Grant (RFC 8628) Proxy for Cognito
 *
 * AWS Cognito doesn't natively support device flow, so we implement a proxy:
 * 1. Generate device_code and user_code, store in DynamoDB
 * 2. User visits approval page, enters code, redirects to Cognito
 * 3. Cognito authenticates user, redirects back to our callback
 * 4. We exchange the auth code for tokens, store in DynamoDB
 * 5. CLI polls our token endpoint until tokens are available
 *
 * Reference: https://aws.amazon.com/blogs/security/implement-oauth-2-0-device-grant-flow-by-using-amazon-cognito-and-aws-lambda/
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'node:crypto';

const dynamo = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME!;

// Device code expiry in seconds (5 minutes)
const DEVICE_CODE_EXPIRY_SECONDS = 300;

// Polling interval in seconds (5 seconds)
const POLLING_INTERVAL_SECONDS = 5;

/**
 * Generate a random device code (URL-safe base64, 32 bytes).
 */
function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a user-friendly user code (e.g., "ABCD-1234").
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';

  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  code += '-';
  for (let i = 0; i < 4; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

/**
 * Get the base URL - prefer BASE_URL env var if set (custom domain),
 * otherwise construct from request headers (CloudFront domain).
 */
function getBaseUrl(c: any): string {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
  return `${proto}://${host}`;
}

/**
 * Create device flow routes.
 */
export function createDeviceFlowRoutes() {
  const app = new Hono();

  // ============================================================
  // POST /oauth2/device_authorization
  // Start device flow - generate codes and store in DynamoDB
  // ============================================================
  app.post('/oauth2/device_authorization', async (c) => {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const baseUrl = getBaseUrl(c);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_CODE_EXPIRY_SECONDS * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    // Store device code in DynamoDB
    await dynamo.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          PK: `DEVICE#${deviceCode}`,
          SK: '#META',
          userCode,
          status: 'pending',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          ttl, // DynamoDB TTL for automatic cleanup
        }),
      })
    );

    // Also store a lookup from user code to device code
    await dynamo.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          PK: `USERCODE#${userCode}`,
          SK: '#META',
          deviceCode,
          ttl,
        }),
      })
    );

    // Return device flow response per RFC 8628
    return c.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/device`,
      verification_uri_complete: `${baseUrl}/device?user_code=${userCode}`,
      expires_in: DEVICE_CODE_EXPIRY_SECONDS,
      interval: POLLING_INTERVAL_SECONDS,
    });
  });

  // ============================================================
  // GET /device
  // Approval page - user enters code or arrives via verification_uri_complete
  // ============================================================
  app.get('/device', async (c) => {
    const userCode = c.req.query('user_code');
    const error = c.req.query('error');
    const baseUrl = getBaseUrl(c);

    // If user code provided, validate it
    let validCode = false;
    let deviceCode: string | null = null;

    if (userCode) {
      const response = await dynamo.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({
            PK: `USERCODE#${userCode}`,
            SK: '#META',
          }),
          ConsistentRead: true
        }),
      );

      if (response.Item) {
        const item = unmarshall(response.Item);
        deviceCode = item.deviceCode;
        validCode = true;
      }
    }

    // If valid code, redirect to Cognito
    if (validCode && deviceCode) {
      const cognitoDomain = process.env.COGNITO_DOMAIN!;
      const clientId = process.env.COGNITO_CLIENT_ID!;
      const callbackUrl = `${baseUrl}/oauth2/callback`;

      // Redirect to Cognito hosted UI with state=deviceCode
      // If OIDC provider is configured, skip Cognito's login page and go directly to IdP
      const cognitoUrl = new URL(`https://${cognitoDomain}/oauth2/authorize`);
      cognitoUrl.searchParams.set('response_type', 'code');
      cognitoUrl.searchParams.set('client_id', clientId);
      cognitoUrl.searchParams.set('redirect_uri', callbackUrl);
      cognitoUrl.searchParams.set('scope', 'openid email profile');
      cognitoUrl.searchParams.set('state', deviceCode);

      // Use OIDC identity provider if configured (e.g., EntraID)
      const identityProvider = process.env.OIDC_PROVIDER_NAME;
      if (identityProvider) {
        cognitoUrl.searchParams.set('identity_provider', identityProvider);
      }

      return c.redirect(cognitoUrl.toString());
    }

    // Render approval page
    const errorMessage = error === 'invalid_code' ? 'Invalid or expired code. Please try again.' : '';

    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Device Authorization - e3</title>
          <style>
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 40px;
              max-width: 400px;
              width: 100%;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            }
            h1 {
              color: #1a1a2e;
              font-size: 24px;
              margin-bottom: 8px;
              text-align: center;
            }
            p {
              color: #6b7280;
              text-align: center;
              margin-bottom: 24px;
            }
            .error {
              background: #fef2f2;
              color: #dc2626;
              padding: 12px;
              border-radius: 8px;
              margin-bottom: 16px;
              text-align: center;
            }
            form {
              display: flex;
              flex-direction: column;
              gap: 16px;
            }
            input {
              padding: 14px 16px;
              font-size: 24px;
              font-family: monospace;
              text-align: center;
              letter-spacing: 2px;
              border: 2px solid #e5e7eb;
              border-radius: 8px;
              text-transform: uppercase;
            }
            input:focus {
              outline: none;
              border-color: #667eea;
            }
            button {
              padding: 14px 24px;
              font-size: 16px;
              font-weight: 600;
              color: white;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              border: none;
              border-radius: 8px;
              cursor: pointer;
              transition: transform 0.1s, box-shadow 0.1s;
            }
            button:hover {
              transform: translateY(-1px);
              box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
            .logo {
              text-align: center;
              margin-bottom: 24px;
              font-size: 32px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">⚡</div>
            <h1>Sign in to e3</h1>
            <p>Enter the code shown in your terminal</p>
            ${errorMessage ? html`<div class="error">${errorMessage}</div>` : ''}
            <form method="GET" action="/device">
              <input
                type="text"
                name="user_code"
                placeholder="XXXX-0000"
                pattern="[A-Za-z]{4}-[0-9]{4}"
                maxlength="9"
                required
                autofocus
              />
              <button type="submit">Continue</button>
            </form>
          </div>
        </body>
      </html>
    `);
  });

  // ============================================================
  // GET /oauth2/callback
  // Cognito callback - exchange code for tokens, store in DynamoDB
  // ============================================================
  app.get('/oauth2/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state'); // This is the device_code
    const error = c.req.query('error');

    if (error) {
      return c.redirect(`/device?error=${error}`);
    }

    if (!code || !state) {
      return c.redirect('/device?error=missing_params');
    }

    const deviceCode = state;
    const baseUrl = getBaseUrl(c);

    try {
      // Exchange auth code for tokens with Cognito
      const cognitoDomain = process.env.COGNITO_DOMAIN!;
      const clientId = process.env.COGNITO_CLIENT_ID!;
      const callbackUrl = `${baseUrl}/oauth2/callback`;

      const tokenResponse = await fetch(`https://${cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: callbackUrl,
        }),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        console.error('Token exchange failed:', errorBody);
        return c.redirect('/device?error=token_exchange_failed');
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      };

      // Store tokens in DynamoDB, keyed by device_code
      await dynamo.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: marshall({
            PK: `DEVICE#${deviceCode}`,
            SK: '#META',
          }),
          UpdateExpression: 'SET #status = :status, accessToken = :accessToken, refreshToken = :refreshToken, idToken = :idToken, expiresIn = :expiresIn, approvedAt = :approvedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':status': 'approved',
            ':accessToken': tokens.access_token,
            ':refreshToken': tokens.refresh_token ?? '',
            ':idToken': tokens.id_token ?? '',
            ':expiresIn': tokens.expires_in ?? 3600,
            ':approvedAt': new Date().toISOString(),
          }),
        })
      );

      // Show success page
      return c.html(html`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Authorized - e3</title>
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
              }
              .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
                text-align: center;
              }
              .success { font-size: 48px; margin-bottom: 16px; }
              h1 { color: #059669; font-size: 24px; margin-bottom: 8px; }
              p { color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✓</div>
              <h1>Authorized!</h1>
              <p>You can close this window and return to your terminal.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('Callback error:', err);
      return c.redirect('/device?error=internal_error');
    }
  });

  // ============================================================
  // POST /oauth2/token
  // Token endpoint - CLI polls here for tokens
  // ============================================================
  app.post('/oauth2/token', async (c) => {
    const contentType = c.req.header('content-type');
    let deviceCode: string | undefined;
    let grantType: string | undefined;
    let refreshToken: string | undefined;

    // Parse form data
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const formData = await c.req.parseBody();
      deviceCode = formData.device_code as string;
      grantType = formData.grant_type as string;
      refreshToken = formData.refresh_token as string;
    } else {
      // Try JSON
      try {
        const body = await c.req.json();
        deviceCode = body.device_code;
        grantType = body.grant_type;
        refreshToken = body.refresh_token;
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }
    }

    // Handle refresh token grant
    if (grantType === 'refresh_token' && refreshToken) {
      const cognitoDomain = process.env.COGNITO_DOMAIN!;
      const clientId = process.env.COGNITO_CLIENT_ID!;

      try {
        const tokenResponse = await fetch(`https://${cognitoDomain}/oauth2/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: refreshToken,
          }),
        });

        if (!tokenResponse.ok) {
          const errorBody = await tokenResponse.json().catch(() => ({}));
          return c.json({
            error: (errorBody as any).error ?? 'invalid_grant',
            error_description: (errorBody as any).error_description ?? 'Failed to refresh token',
          }, 400);
        }

        const tokens = await tokenResponse.json() as {
          access_token: string;
          refresh_token?: string;
          id_token?: string;
          expires_in?: number;
        };
        return c.json({
          access_token: tokens.access_token,
          token_type: 'Bearer',
          expires_in: tokens.expires_in ?? 3600,
          refresh_token: tokens.refresh_token ?? refreshToken,
          id_token: tokens.id_token,
        });
      } catch (err) {
        console.error('Refresh token error:', err);
        return c.json({ error: 'server_error' }, 500);
      }
    }

    // Handle device code grant
    if (grantType !== 'urn:ietf:params:oauth:grant-type:device_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    if (!deviceCode) {
      return c.json({ error: 'invalid_request', error_description: 'device_code required' }, 400);
    }

    // Look up device code in DynamoDB
    const response = await dynamo.send(
      new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          PK: `DEVICE#${deviceCode}`,
          SK: '#META',
        }),
        ConsistentRead: true
      })
    );

    if (!response.Item) {
      return c.json({ error: 'expired_token' }, 400);
    }

    const item = unmarshall(response.Item);

    // Check if expired
    if (new Date(item.expiresAt) < new Date()) {
      return c.json({ error: 'expired_token' }, 400);
    }

    // Check status
    if (item.status === 'pending') {
      return c.json({ error: 'authorization_pending' }, 400);
    }

    if (item.status === 'denied') {
      return c.json({ error: 'access_denied' }, 400);
    }

    if (item.status !== 'approved') {
      return c.json({ error: 'server_error' }, 500);
    }

    // Return tokens
    return c.json({
      access_token: item.accessToken,
      token_type: 'Bearer',
      expires_in: item.expiresIn ?? 3600,
      refresh_token: item.refreshToken || undefined,
      id_token: item.idToken || undefined,
    });
  });

  return app;
}

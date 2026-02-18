/**
 * Utilities for reading e3 CLI credentials with automatic token refresh.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

interface CredentialsFile {
  version: number;
  credentials: Record<string, ServerCredentials>;
}

interface ServerCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

interface OIDCConfig {
  token_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function getCredentialsPath(): string {
  return process.env.E3_CREDENTIALS_PATH ?? join(homedir(), '.e3', 'credentials.json');
}

function readCredentials(): CredentialsFile {
  const credPath = getCredentialsPath();
  if (!existsSync(credPath)) {
    throw new Error('Credentials file not found');
  }
  return JSON.parse(readFileSync(credPath, 'utf-8'));
}

function writeCredentials(creds: CredentialsFile): void {
  const credPath = getCredentialsPath();
  writeFileSync(credPath, JSON.stringify(creds, null, 2));
}

async function refreshAccessToken(server: string, refreshToken: string): Promise<ServerCredentials> {
  const oidcResponse = await fetch(`${server}/.well-known/openid-configuration`);
  if (!oidcResponse.ok) {
    throw new Error(`Failed to fetch OIDC config: ${oidcResponse.status}`);
  }

  const oidcConfig = (await oidcResponse.json()) as OIDCConfig;
  const tokenEndpoint = oidcConfig.token_endpoint;

  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'e3-cli',
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${tokenResponse.status} - ${errorText}`);
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt,
  };
}

export async function getToken(server = DEFAULT_SERVER): Promise<string> {
  const credPath = getCredentialsPath();

  if (!existsSync(credPath)) {
    throw new Error(`Not logged in. Run: e3 login ${server}`);
  }

  let creds: CredentialsFile;
  try {
    creds = readCredentials();
  } catch {
    throw new Error(`Invalid credentials file. Run: e3 login ${server}`);
  }

  const serverCreds = creds.credentials?.[server];

  if (!serverCreds?.accessToken) {
    throw new Error(`No credentials for ${server}. Run: e3 login ${server}`);
  }

  const isExpired = serverCreds.expiresAt && new Date(serverCreds.expiresAt) < new Date();

  if (isExpired) {
    if (!serverCreds.refreshToken) {
      throw new Error(`Token expired and no refresh token available. Run: e3 login ${server}`);
    }

    console.log('Access token expired, refreshing...');

    try {
      const newCreds = await refreshAccessToken(server, serverCreds.refreshToken);
      creds.credentials[server] = newCreds;
      writeCredentials(creds);
      console.log('Token refreshed successfully');
      return newCreds.accessToken;
    } catch (err) {
      throw new Error(`Failed to refresh token: ${err}. Run: e3 login ${server}`);
    }
  }

  return serverCreds.accessToken;
}

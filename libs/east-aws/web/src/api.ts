/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { RequestOptions } from '@elaraai/e3-api-client';
import { loadConfig } from './config';

/** Same-origin API — CloudFront routes /api to API Gateway */
export const API_URL = '';

export function getToken(): string | null {
  return localStorage.getItem('e3_token');
}

export function setToken(token: string): void {
  localStorage.setItem('e3_token', token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('e3_refresh_token');
}

export function setRefreshToken(token: string): void {
  localStorage.setItem('e3_refresh_token', token);
}

export function clearTokens(): void {
  localStorage.removeItem('e3_token');
  localStorage.removeItem('e3_refresh_token');
}

export function getRequestOptions(): RequestOptions {
  return { token: getToken() };
}

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token on success, or null if refresh fails.
 */
let refreshPromise: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const config = await loadConfig();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.cognitoClientId,
        refresh_token: refreshToken,
      });

      const res = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!res.ok) return null;

      const data = await res.json();
      setToken(data.access_token);
      // Cognito refresh_token grant doesn't return a new refresh_token
      return data.access_token as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Redirect to login page, clearing all tokens.
 */
export function redirectToLogin(): void {
  clearTokens();
  window.location.href = '/login';
}

/**
 * Install a fetch interceptor that transparently handles 401 token refresh.
 * On 401 from an API request: refresh the Cognito token and retry once.
 * Retries go through the original fetch (not the interceptor), so loops are impossible.
 */
export function installAuthInterceptor(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

    // Only intercept our API requests, not external calls (e.g. Cognito token endpoint)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (response.status !== 401 || !url.includes('/api/')) {
      return response;
    }

    const token = await refreshAccessToken();
    if (!token) {
      redirectToLogin();
      return response;
    }

    // Retry with the new token — goes through originalFetch, not this interceptor
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
}

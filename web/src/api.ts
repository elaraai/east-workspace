/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { RequestOptions } from '@elaraai/e3-api-client';

/** Same-origin API — CloudFront routes /api to API Gateway */
export const API_URL = '';

export function getToken(): string | null {
  return localStorage.getItem('e3_token');
}

export function getRequestOptions(): RequestOptions {
  return { token: getToken() };
}

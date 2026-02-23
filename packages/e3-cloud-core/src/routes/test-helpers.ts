/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Test helpers for API route unit tests.
 *
 * Provides utilities for:
 * - Building mock API Gateway events with JWT identity
 * - BEAST2 encoding/decoding for request/response bodies
 * - Mounting Hono route apps under correct paths
 * - Sending test requests with identity and body
 */

import { Hono } from 'hono';
import { encodeBeast2For, decodeBeast2For, type EastType, type ValueTypeOf } from '@elaraai/east';
import { ApiTypes } from '@elaraai/e3-api-server';

/**
 * Build a mock API Gateway event with JWT authorizer claims.
 *
 * Routes extract identity via identityBackend.getIdentity(event) which reads
 * event.requestContext.authorizer.jwt.claims.
 */
export function mockLambdaEvent(identity: { sub: string; email?: string; name?: string; isAdmin?: boolean } | null) {
  if (!identity) return {};
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: identity.sub,
            email: identity.email,
            name: identity.name,
            'e3:is_admin': identity.isAdmin ? 'true' : undefined,
          },
        },
      },
    },
  };
}

/**
 * Decode a BEAST2-encoded response wrapped in ResponseType(T).
 *
 * Routes return variant('success', value) or variant('error', ...).
 */
export async function decodeResponse<T extends EastType>(res: Response, type: T): Promise<{ type: 'success'; value: ValueTypeOf<T> } | { type: 'error'; value: unknown }> {
  const responseType = ApiTypes.ResponseType(type);
  const decode = decodeBeast2For(responseType);
  const buffer = await res.arrayBuffer();
  return decode(new Uint8Array(buffer)) as any;
}

/**
 * Encode a value as BEAST2 bytes for use as a request body.
 */
export function encodeRequestBody<T extends EastType>(type: T, value: ValueTypeOf<T>): Uint8Array {
  const encode = encodeBeast2For(type);
  return encode(value);
}

/**
 * Mount a route app under the correct base path.
 *
 * Routes read params from the parent Hono mount path, so tests must
 * mount under the same path used in the composition root.
 */
export function mountApp(routeApp: Hono, basePath: string): Hono {
  const app = new Hono();
  app.route(basePath, routeApp);
  return app;
}

/**
 * Send a request to a Hono app with optional identity and body.
 */
export async function fetchRoute(
  app: Hono, method: string, path: string,
  options?: { identity?: { sub: string; email?: string; name?: string; isAdmin?: boolean }; body?: Uint8Array }
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: options?.body ? { 'content-type': 'application/beast2' } : {},
    body: options?.body ?? null,
  });
  return app.fetch(req, { event: mockLambdaEvent(options?.identity ?? null) });
}

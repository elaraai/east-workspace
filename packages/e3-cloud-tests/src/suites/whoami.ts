/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test suite for GET /api/whoami endpoint.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { whoami } from '@elaraai/e3-cloud-client';
import { variant, equalFor, OptionType, StringType } from '@elaraai/east';
import type { AdminTestContext } from '../context.js';
import { expectError } from '../helpers.js';

/** Helper to create Option<string> values for comparison */
const some = (value: string) => variant('some', value);

/** Equality function for Option<string> */
const optionStringEqual = equalFor(OptionType(StringType));

/**
 * Register whoami tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function whoamiTests(getContext: () => AdminTestContext): void {
  void describe('GET /api/whoami', () => {
    void it('returns user info for authenticated request', async () => {
      const ctx = getContext();
      const ownerUser = await ctx.getTestUser('owner');

      const user = await whoami(ctx.config.baseUrl, await ctx.opts('owner'));

      assert.strictEqual(user.sub, ownerUser.sub);
      // email is Option<string>, use structural comparison
      assert.ok(optionStringEqual(user.email, some(ownerUser.email)),
        `Expected email some("${ownerUser.email}"), got ${JSON.stringify(user.email)}`);
      assert.strictEqual(user.isAdmin, false);
    });

    void it('admin user has isAdmin=true', async () => {
      const ctx = getContext();
      const adminUser = await ctx.getTestUser('admin');

      const user = await whoami(ctx.config.baseUrl, await ctx.opts('admin'));

      assert.strictEqual(user.sub, adminUser.sub);
      assert.strictEqual(user.isAdmin, true);
    });

    void it('returns unauthorized for unauthenticated request', async () => {
      const ctx = getContext();

      await expectError(
        whoami(ctx.config.baseUrl, { token: null }),
        'unauthorized'
      );
    });

    void it('returns unauthorized for invalid token', async () => {
      const ctx = getContext();

      await expectError(
        whoami(ctx.config.baseUrl, { token: 'invalid-token' }),
        'unauthorized'
      );
    });

    void it('different users return different identities', async () => {
      const ctx = getContext();
      const ownerUser = await ctx.getTestUser('owner');
      const memberUser = await ctx.getTestUser('member');

      const owner = await whoami(ctx.config.baseUrl, await ctx.opts('owner'));
      const member = await whoami(ctx.config.baseUrl, await ctx.opts('member'));

      assert.notStrictEqual(owner.sub, member.sub);
      assert.strictEqual(owner.sub, ownerUser.sub);
      assert.strictEqual(member.sub, memberUser.sub);
    });
  });
}

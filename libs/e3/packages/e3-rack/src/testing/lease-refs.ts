/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, equalFor } from '@elaraai/east';
import { RackLeaseRefType } from '../protocol/rack-wire.js';

/**
 * Whether two lists name the same leases, in order: what a test compares a
 * heartbeat's `stop` with, as East compares its values.
 *
 * @example
 * assert.ok(sameLeaseRefs((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]));
 */
export const sameLeaseRefs = equalFor(ArrayType(RackLeaseRefType));

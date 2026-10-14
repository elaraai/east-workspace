/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { InMemoryRackLeaseStore } from './in-memory-lease-store.js';
import { leaseStoreContract } from '../testing/lease-store-contract.js';

leaseStoreContract('memory', () => new InMemoryRackLeaseStore());

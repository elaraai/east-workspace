/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { InMemoryRackRegistry } from './rack-registry.js';
import { rackRegistryContract } from '../testing/rack-registry-contract.js';

rackRegistryContract('memory', () => new InMemoryRackRegistry());

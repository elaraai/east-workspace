/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit worker the runner's Chromium specs start: it serves units as an
 * app's unit worker does, with the specs' own platform package beside the
 * standard one.
 *
 * The harness bundles it for Chromium; `runner.page.ts` starts it.
 *
 * @packageDocumentation
 */

import { TEST_PLATFORM, testPlatform } from '../testing/test-platform.js';
import { serveUnits } from '../units.js';

serveUnits({ platforms: { [TEST_PLATFORM]: testPlatform } });

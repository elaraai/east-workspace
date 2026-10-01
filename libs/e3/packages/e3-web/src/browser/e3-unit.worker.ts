/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit worker the specs' e3 worker starts: it serves units as an app's
 * unit worker does — `serveUnits()`, with east-node-std's platform functions
 * and e3's own — and the hold beside them, holding when its URL says.
 *
 * The harness bundles it for Chromium; `e3.worker.ts` starts it.
 *
 * @packageDocumentation
 */

import { HOLD_PLATFORM, holdPlatform } from '../testing/hold-platform.js';
import { serveUnits } from '../units.js';

const held = new URL(self.location.href).searchParams.get('hold') === '1';
serveUnits({ platforms: { [HOLD_PLATFORM]: holdPlatform(held) } });

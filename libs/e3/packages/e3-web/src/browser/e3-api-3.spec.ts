/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The shared API suites against e3 in Chromium, part 3 of
 * `API_SUITE_PARTS` (`e3-api.ts`): a browser and a page of its own, run
 * beside the other parts.
 */

import { apiSuitesInChromium } from './e3-api.js';

apiSuitesInChromium(import.meta.url);

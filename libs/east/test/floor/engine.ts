/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Makes this process an engine with nothing newer than ES2023, before anything else loads:
 * `node --import ./dist/test/floor/engine.js …`, as `make test-floor` runs East's suite. `EAST_FLOOR_SAY=1` prints
 * what was taken away.
 */
import { FLOOR, takeAway } from "./es2023.js";

const gone = takeAway(FLOOR);
(globalThis as { EAST_FLOOR?: readonly string[] }).EAST_FLOOR = gone;
if (process.env.EAST_FLOOR_SAY) console.error(`[east floor] taken away: ${gone.join(", ")}`);

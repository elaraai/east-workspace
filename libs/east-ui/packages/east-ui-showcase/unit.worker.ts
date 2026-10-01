/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's unit worker (#849): where the e3 the page runs runs East
 * programs — the showcase's tasks, functions and mutations. east-web-std
 * answers east-node-std's platform functions, which the showcase's runner
 * lists, and e3's own reach the e3 worker that started this one.
 *
 * @packageDocumentation
 */

import { serveUnits } from "@elaraai/e3-web/units";

serveUnits();

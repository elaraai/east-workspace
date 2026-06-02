/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Side-effect module: registers the global error handlers. Imported FIRST in
 * `main.tsx` so the listeners are live before the (eagerly-evaluated) catalog
 * import can throw — a load-time crash then surfaces as the copyable alert
 * instead of a blank page.
 *
 * @packageDocumentation
 */

import { installGlobalErrorHandlers } from "./components/ErrorOverlay";

installGlobalErrorHandlers();

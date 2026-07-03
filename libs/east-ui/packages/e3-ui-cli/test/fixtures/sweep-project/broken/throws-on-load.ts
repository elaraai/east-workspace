/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Sweep fixture: a module whose EVALUATION throws — the sweep must record it
// as a skipped file (with the load error) and keep going.
throw new Error("this module always fails to load");

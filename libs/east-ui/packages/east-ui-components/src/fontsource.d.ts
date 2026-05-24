/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Ambient declarations for the self-hosted brand fonts. The
 * `@fontsource-variable/*` packages ship CSS-only entry points (no .d.ts),
 * but we side-effect-import them from `src/index.ts` to register the
 * `@font-face` rules. TS needs a module shim so those imports type-check. */
declare module "@fontsource-variable/dm-sans";
declare module "@fontsource-variable/inter-tight";
declare module "@fontsource-variable/jetbrains-mono";

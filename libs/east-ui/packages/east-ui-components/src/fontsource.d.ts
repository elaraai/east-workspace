/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Ambient declarations for the self-hosted brand fonts. The
 * `@fontsource-variable/*` packages ship CSS only (no .d.ts), and
 * `src/fonts.ts` side-effect-imports their stylesheets by path to register
 * the `@font-face` rules. TS needs a module shim so those imports type-check. */
declare module "@fontsource-variable/dm-sans/wght.css";
declare module "@fontsource-variable/inter-tight/wght.css";
declare module "@fontsource-variable/jetbrains-mono/wght.css";
declare module "@fontsource-variable/jetbrains-mono/wght-italic.css";

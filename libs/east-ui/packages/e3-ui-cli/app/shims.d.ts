/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The @fontsource side-effect imports resolve to CSS (no type declarations);
// declare them so `tsc -p app/tsconfig.json` can type-check the browser entry.
declare module '@fontsource-variable/dm-sans';
declare module '@fontsource-variable/inter-tight';
declare module '@fontsource-variable/jetbrains-mono';

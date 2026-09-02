/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer-side §0 contract helpers — the enforcement spine consumed by every
 * primitive and pattern renderer.
 *
 * @remarks
 * - `paired-icon` (§0.3): `resolvePairedIcon(status, showIcon?)` returns the
 *   FA icon every status-bearing renderer must render alongside colour.
 * - `reduced-motion` (§0.2): `usePrefersReducedMotion()` — animation renderers
 *   degrade to `none` when the hook returns `true`.
 * - `hover-intent` (§0.5): `resolveHoverIntent(token)` — shared `openDelay` /
 *   `closeDelay` across every hover-to-open primitive.
 * - `density` / `verbosity` (§1.1 / §0.4): React contexts + hooks for the
 *   `DensityType` / `VerbosityType` cascade.
 * - `plot-gutter` (#147): React context + hook for the shared `{ left, right }`
 *   plot gutter a stacking layout can impose on its axis/lane children.
 * - `adaptive` (#346): container-width + pointer-capability hooks — the
 *   responsive spine (`useContainerBreakpoint` / `useContainerBelow` /
 *   `useCoarsePointer` / `useHoverCapable`).
 *
 * Pure value resolvers (TextStyle, Elevation, Motion, Focus, Animation) live
 * under `../style/` — the split is: this folder owns contract enforcement
 * (React hooks, defaulting rules, cross-cutting data); `style/` owns
 * token-to-CSS lookups.
 *
 * @packageDocumentation
 */

export { type StatusToken, STATUS_ICON, resolvePairedIcon } from "./paired-icon.js";
export { usePrefersReducedMotion } from "./reduced-motion.js";
export { type HoverIntent, type HoverIntentDelays, resolveHoverIntent } from "./hover-intent.js";
export {
    type Density, type Verbosity,
    type DensityProviderProps, type VerbosityProviderProps,
    DensityProvider, useDensity,
    VerbosityProvider, useVerbosity,
} from "./density.js";
export { type PlotGutter, type PlotGutterProviderProps, PlotGutterProvider, usePlotGutter } from "./plot-gutter.js";
export {
    type ContainerBreakpoint, type ContainerBreakpointThresholds,
    useContainerBreakpoint, useContainerBelow,
    useCoarsePointer, useHoverCapable,
} from "./adaptive.js";

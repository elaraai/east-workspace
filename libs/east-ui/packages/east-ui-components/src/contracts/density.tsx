/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React contexts + hooks for the `DensityType` and `VerbosityType` cascade.
 *
 * `DensityProvider` / `useDensity` — information-density context.
 * `VerbosityProvider` / `useVerbosity` — narrative-vs-data ratio context.
 *
 * Any primitive that consumes density or verbosity reads the context first,
 * then falls back to its own prop override. This matches the §1.1 rule:
 * per-component override wins over the inherited cascade. Mirrors the
 * `UIStoreProvider` precedent in `../platform/state-hooks.tsx`.
 */

import { createContext, useContext, type ReactNode } from "react";

export type Density = "comfortable" | "compact" | "condensed";
export type Verbosity = "minimal" | "standard" | "detailed";

const DensityContext = createContext<Density | undefined>(undefined);
const VerbosityContext = createContext<Verbosity>("standard");

export interface DensityProviderProps {
    readonly value: Density;
    readonly children: ReactNode;
}

export function DensityProvider({ value, children }: DensityProviderProps) {
    return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

/**
 * Read the inherited density from context, or `undefined` when no surface
 * (Table, ChipRail, …) provides one — so a consumer can tell "no density
 * anywhere" (keep the standalone look) apart from an inherited value.
 */
export function useDensity(): Density | undefined {
    return useContext(DensityContext);
}

export interface VerbosityProviderProps {
    readonly value: Verbosity;
    readonly children: ReactNode;
}

export function VerbosityProvider({ value, children }: VerbosityProviderProps) {
    return <VerbosityContext.Provider value={value}>{children}</VerbosityContext.Provider>;
}

/**
 * Read the current verbosity from context. Defaults to `"standard"` when
 * no provider wraps the caller.
 */
export function useVerbosity(): Verbosity {
    return useContext(VerbosityContext);
}

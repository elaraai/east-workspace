/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `AppProvider` — host-side injection for the `<App>` shell (#367).
 *
 * Embedding React apps wrap the renderer in `<AppProvider …>` to inject their own
 * chrome (avatar menu, theme toggle, logout, console links, global search) as
 * **React nodes** into the shell's named app-bar / rail slots. `EastChakraApp`
 * reads them from this context and places them alongside any IR-declared
 * `barStart` / `barEnd` nodes (host content trails author content). With no
 * provider the shell renders standalone from its IR + default logo, so e3 `ui()`
 * tasks and the snapshot pipeline keep working.
 *
 * Mirrors the existing renderer providers (`OverlayManagerProvider`,
 * `UIStoreProvider`, `DragLayerProvider`).
 *
 * @packageDocumentation
 */

import { createContext, useContext, type ReactNode } from "react";

/**
 * Host-injected app-shell slots (all optional React nodes).
 *
 * @remarks
 * The bar slots (`barStart` / `barCenter` / `barEnd`) render as **direct children
 * of the app bar's flex row**, so for multiple items pass a **`Fragment` of
 * individual elements** — `barEnd={<><Bell/><Avatar/></>}` — NOT a `<Flex gap>`
 * wrapper. A Fragment lets each item share the bar's single gap (and, for
 * `barEnd`, the same rhythm as the built-in theme toggle); a wrapping element with
 * its own `gap` would introduce a second, independent spacing system. Wrap only
 * when an item is a self-contained widget (e.g. a menu trigger + its content).
 *
 * @property barStart - App-bar content after the breadcrumb (leading) — e.g. an environment switcher.
 * @property barCenter - App-bar center content — e.g. a global search input.
 * @property barEnd - App-bar trailing content — avatar menu, theme toggle, logout, console.
 * @property logo - A React logo node; overrides the IR `logo` image source when set.
 * @property railFooter - Pinned rail footer — e.g. an account / version card.
 * @property bannerTop - A full-width strip above the header — e.g. an impersonation / environment banner.
 */
export interface AppSlots {
    /** App-bar content after the breadcrumb (leading). */
    barStart?: ReactNode;
    /** App-bar center content (e.g. global search). */
    barCenter?: ReactNode;
    /** App-bar trailing content (avatar / theme / logout / console). */
    barEnd?: ReactNode;
    /** React logo node; overrides the IR `logo` image source. */
    logo?: ReactNode;
    /** Pinned rail footer (account / version). */
    railFooter?: ReactNode;
    /** Full-width strip above the header (impersonation / notice banner). */
    bannerTop?: ReactNode;
}

const AppSlotsContext = createContext<AppSlots>({});

/** Props for {@link AppProvider} — the {@link AppSlots} plus the wrapped tree. */
export interface AppProviderProps extends AppSlots {
    /** The rendered `<App>` tree (typically a `UIComponentRenderer` / `EastChakraComponent`). */
    children: ReactNode;
}

/**
 * Provides host-injected app-shell slots to a wrapped `<App>` renderer.
 *
 * @param props - The {@link AppSlots} to inject plus `children`.
 * @returns The wrapped tree with the slots available via {@link useAppSlots}.
 */
export function AppProvider({ children, ...slots }: AppProviderProps): ReactNode {
    return <AppSlotsContext.Provider value={slots}>{children}</AppSlotsContext.Provider>;
}

/**
 * Reads the host-injected {@link AppSlots} from the nearest {@link AppProvider}.
 * Returns an empty object when there is no provider (standalone `<App>`).
 *
 * @returns The injected slots (empty when unprovided).
 */
export function useAppSlots(): AppSlots {
    return useContext(AppSlotsContext);
}

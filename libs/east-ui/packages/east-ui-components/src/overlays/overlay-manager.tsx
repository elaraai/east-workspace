/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { createContext, useContext, useState, useEffect, useCallback, memo, type ReactNode } from "react";
import { chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { type PlatformFunction } from "@elaraai/east/internal";
import { dialog_open, drawer_open } from "@elaraai/east-ui/internal";
import { DialogContent, type DialogOpenInputValue } from "./dialog/index.js";
import { DrawerContent, type DrawerOpenInputValue } from "./drawer/index.js";
import { getSomeorUndefined } from "../utils";

// Stack-rail icons (#328) are dynamic FA names; register the free-solid set.
library.add(fas);

interface PendingDialog {
    id: string;
    value: DialogOpenInputValue;
}

interface PendingDrawer {
    id: string;
    value: DrawerOpenInputValue;
}

interface OverlayManagerContextValue {
    openDialog: (value: DialogOpenInputValue) => void;
    openDrawer: (value: DrawerOpenInputValue) => void;
}

// ============================================================================
// Context
// ============================================================================

const OverlayManagerContext = createContext<OverlayManagerContextValue | null>(null);

let globalOverlayManager: OverlayManagerContextValue | null = null;

export function useOverlayManager(): OverlayManagerContextValue {
    const context = useContext(OverlayManagerContext);
    if (!context) {
        throw new Error("useOverlayManager must be used within an OverlayManagerProvider");
    }
    return context;
}

// ============================================================================
// Drawer stack rails (#328)
// ============================================================================

interface DrawerRailMeta {
    title: string | undefined;
    icon: string | undefined;
    stacked: boolean;
    placement: string;
}

/** Read the rail-relevant fields off a programmatic drawer's open input. */
function drawerMeta(value: DrawerOpenInputValue): DrawerRailMeta {
    const title = getSomeorUndefined(value.title);
    const style = getSomeorUndefined(value.style);
    const stacked = style ? (getSomeorUndefined(style.stacked) ?? false) : false;
    const icon = style ? getSomeorUndefined(style.stackIcon) : undefined;
    const placement = (style ? getSomeorUndefined(style.placement)?.type : undefined) ?? "end";
    return { title, icon, stacked, placement };
}

interface DrawerStackRailProps {
    meta: DrawerRailMeta;
    onClick: () => void;
}

/**
 * One ancestor drawer collapsed to a full-height rail (#328) — icon + rotated
 * title. `memo`'d so re-rendering the active drawer doesn't re-render the rails.
 */
const DrawerStackRail = memo(function DrawerStackRail({ meta, onClick }: DrawerStackRailProps) {
    const styles = useSlotRecipe({ key: "drawerStackRail" })();
    const label = meta.title ?? "Back";
    // Chevron points back toward the panel: an end-placed panel sits to the
    // rail's right (chevron ▸), a start-placed one to its left (◂).
    const chevron = meta.placement === "start" ? faChevronLeft : faChevronRight;
    return (
        <chakra.button css={styles.rail} aria-label={`Back to ${label}`} onClick={onClick}>
            <FontAwesomeIcon icon={meta.icon ? (meta.icon as IconName) : chevron} />
            <chakra.span css={styles.label}>{label}</chakra.span>
        </chakra.button>
    );
});

interface DrawerStackRailGroupProps {
    ancestors: { id: string; meta: DrawerRailMeta }[];
    placement: string;
    onPopTo: (id: string) => void;
}

/**
 * The full-height rail spine (#328) — a flex sibling of the drawer panel INSIDE
 * the active drawer's Positioner, so it inherits the drawer's overlay layer (no
 * hardcoded z-index) and stands full-height beside the panel. `order` pins it to
 * the panel's INNER edge: after a start/top-placed panel, before an end-placed
 * one.
 */
function DrawerStackRailGroup({ ancestors, placement, onPopTo }: DrawerStackRailGroupProps) {
    const styles = useSlotRecipe({ key: "drawerStackRail" })();
    const order = placement === "start" || placement === "top" ? 1 : -1;
    return (
        <chakra.div css={styles.railGroup} order={order}>
            {ancestors.map(({ id, meta }) => (
                <DrawerStackRail key={id} meta={meta} onClick={() => onPopTo(id)} />
            ))}
        </chakra.div>
    );
}

// ============================================================================
// Provider Component
// ============================================================================

export interface OverlayManagerProviderProps {
    children: ReactNode;
}

let dialogIdCounter = 0;
let drawerIdCounter = 0;

/**
 * Provider component for programmatic dialog and drawer management.
 *
 * @remarks
 * Wrap your application with this provider to enable programmatic
 * opening of dialogs and drawers via `Dialog.open` and `Drawer.open`.
 *
 * @example
 * ```tsx
 * import { OverlayManagerProvider } from "@elaraai/east-ui-components";
 *
 * function App() {
 *     return (
 *         <OverlayManagerProvider>
 *             <YourApp />
 *         </OverlayManagerProvider>
 *     );
 * }
 * ```
 */
export function OverlayManagerProvider({ children }: OverlayManagerProviderProps) {
    const [dialogs, setDialogs] = useState<PendingDialog[]>([]);
    const [drawers, setDrawers] = useState<PendingDrawer[]>([]);
    // #328 — fullscreen is tracked per drawer id HERE, not as local DrawerContent
    // state, so a stacked drawer's fullscreen survives the unmount/remount when the
    // nesting changes (it collapses to a rail, then re-mounts full when popped back).
    const [fullscreenIds, setFullscreenIds] = useState<Set<string>>(new Set());

    const toggleFullscreen = useCallback((id: string) => {
        setFullscreenIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Prune fullscreen flags for drawers that have closed. Drawer ids are monotonic
    // (never reused), so this only bounds the set — it can't resurface a stale flag.
    useEffect(() => {
        setFullscreenIds(prev => {
            if (prev.size === 0) return prev;
            const live = new Set(drawers.map(d => d.id));
            let changed = false;
            const next = new Set<string>();
            for (const id of prev) {
                if (live.has(id)) next.add(id);
                else changed = true;
            }
            return changed ? next : prev;
        });
    }, [drawers]);

    const openDialog = useCallback((value: DialogOpenInputValue) => {
        const id = `dialog-${++dialogIdCounter}`;
        setDialogs(prev => [...prev, { id, value }]);
    }, []);

    const closeDialog = useCallback((id: string) => {
        setDialogs(prev => prev.filter(d => d.id !== id));
    }, []);

    const openDrawer = useCallback((value: DrawerOpenInputValue) => {
        const id = `drawer-${++drawerIdCounter}`;
        setDrawers(prev => [...prev, { id, value }]);
    }, []);

    const closeDrawer = useCallback((id: string) => {
        setDrawers(prev => prev.filter(d => d.id !== id));
    }, []);

    // #328 — pop the drawer stack back to `id`, closing every drawer opened
    // after it (a click on that ancestor's collapsed rail).
    const popTo = useCallback((id: string) => {
        setDrawers(prev => {
            const idx = prev.findIndex(d => d.id === id);
            return idx === -1 ? prev : prev.slice(0, idx + 1);
        });
    }, []);

    const contextValue: OverlayManagerContextValue = {
        openDialog,
        openDrawer,
    };

    // Set global reference for platform function implementations
    globalOverlayManager = contextValue;

    return (
        <OverlayManagerContext.Provider value={contextValue}>
            {children}

            {/* Render programmatic dialogs */}
            {dialogs.map(({ id, value }) => (
                <ProgrammaticDialog
                    key={id}
                    value={value}
                    onClose={() => closeDialog(id)}
                />
            ))}

            {/* Render programmatic drawers — a `stacked` ancestor (any drawer
              * that is NOT the deepest) collapses to a vertical rail (#328) that
              * pops the stack to it when clicked; every other drawer renders full
              * (the deepest is always full). */}
            {(() => {
                // Stacked ancestors (any drawer that is NOT the deepest and opted
                // into `stacked`) collapse to rails rendered INSIDE the active
                // drawer's Positioner (#328), so they inherit its overlay layer.
                const stackedAncestors = drawers
                    .slice(0, -1)
                    .map((d) => ({ id: d.id, meta: drawerMeta(d.value) }))
                    .filter(({ meta }) => meta.stacked);
                const activePlacement = drawers.length > 0 ? drawerMeta(drawers[drawers.length - 1]!.value).placement : "end";
                const rails = stackedAncestors.length > 0
                    ? <DrawerStackRailGroup ancestors={stackedAncestors} placement={activePlacement} onPopTo={popTo} />
                    : undefined;
                return drawers.map(({ id, value }, i) => {
                    const isTop = i === drawers.length - 1;
                    // A stacked ancestor renders as a rail in the active drawer's
                    // slot, not as its own (hidden) full drawer.
                    if (!isTop && drawerMeta(value).stacked) return null;
                    return (
                        <ProgrammaticDrawer
                            key={id}
                            value={value}
                            onClose={() => closeDrawer(id)}
                            railsSlot={isTop ? rails : undefined}
                            fullscreen={fullscreenIds.has(id)}
                            onToggleFullscreen={() => toggleFullscreen(id)}
                        />
                    );
                });
            })()}
        </OverlayManagerContext.Provider>
    );
}

// ============================================================================
// Programmatic Dialog Component
// ============================================================================

interface ProgrammaticDialogProps {
    value: DialogOpenInputValue;
    onClose: () => void;
}

function ProgrammaticDialog({ value, onClose }: ProgrammaticDialogProps) {
    // Mount closed, then open after commit. Under StrictMode the dialog machine
    // is mounted twice; if it is born open both instances call preventBodyScroll
    // and the second early-returns without a cleanup, leaking the body scroll-lock
    // (overflow/pointer-events) after close. Settling closed first means only the
    // single surviving instance ever locks the body.
    const [open, setOpen] = useState(false);
    useEffect(() => { setOpen(true); }, []);
    const handleClose = useCallback(() => setOpen(false), []);
    const handleExitComplete = useCallback(() => onClose(), [onClose]);
    return (
        <DialogContent
            value={value}
            storageKey="programmatic-dialog"
            open={open}
            onClose={handleClose}
            onExitComplete={handleExitComplete}
        />
    );
}

// ============================================================================
// Programmatic Drawer Component
// ============================================================================

interface ProgrammaticDrawerProps {
    value: DrawerOpenInputValue;
    onClose: () => void;
    railsSlot?: ReactNode;
    fullscreen: boolean;
    onToggleFullscreen: () => void;
}

function ProgrammaticDrawer({ value, onClose, railsSlot, fullscreen, onToggleFullscreen }: ProgrammaticDrawerProps) {
    // Mount closed, then open after commit — see ProgrammaticDialog for why.
    const [open, setOpen] = useState(false);
    useEffect(() => { setOpen(true); }, []);
    const handleClose = useCallback(() => setOpen(false), []);
    const handleExitComplete = useCallback(() => onClose(), [onClose]);
    return (
        <DrawerContent
            value={value}
            storageKey="programmatic-drawer"
            open={open}
            onClose={handleClose}
            onExitComplete={handleExitComplete}
            railsSlot={railsSlot}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
        />
    );
}

// ============================================================================
// Platform Function Implementations
// ============================================================================

/**
 * Platform implementation for dialog_open.
 *
 * @remarks
 * Requires the application to be wrapped in {@link OverlayManagerProvider}.
 */
export const DialogOpenImpl: PlatformFunction = dialog_open.implement((input) => {
    if (!globalOverlayManager) {
        console.warn("Dialog.open called but OverlayManagerProvider is not mounted. Wrap your app in <OverlayManagerProvider>.");
        return;
    }
    globalOverlayManager.openDialog(input);
});

/**
 * Platform implementation for drawer_open.
 *
 * @remarks
 * Requires the application to be wrapped in {@link OverlayManagerProvider}.
 */
export const DrawerOpenImpl: PlatformFunction = drawer_open.implement((input) => {
    if (!globalOverlayManager) {
        console.warn("Drawer.open called but OverlayManagerProvider is not mounted. Wrap your app in <OverlayManagerProvider>.");
        return;
    }
    globalOverlayManager.openDrawer(input);
});

/**
 * Combined platform implementations for overlay management.
 *
 * @remarks
 * Pass this to `ir.compile()` along with other implementations to enable
 * programmatic dialog and drawer opening.
 *
 * @example
 * ```ts
 * import { State } from "@elaraai/east-ui/internal";
 * import { OverlayImpl } from "@elaraai/east-ui-components";
 *
 * const compiled = myFunction.toIR().compile([...State.Implementation, ...OverlayImpl]);
 * ```
 */
export const OverlayImpl: PlatformFunction[] = [DialogOpenImpl, DrawerOpenImpl];

// Register Overlay platform implementation at module load
import { registerPlatformImplementation } from "../platform/registry.js";
registerPlatformImplementation(OverlayImpl);

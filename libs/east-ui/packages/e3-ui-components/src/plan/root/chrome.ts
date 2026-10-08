/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the canvas hands the frame it renders in (#1193): the canvas itself,
 * for main, and the facts the frame's chrome is drawn from — the toolbar's
 * controls, the session the banners follow, the footer's items — so the
 * canvas draws no toolbar or foot of its own, and the frame places them (`Plan
 * Builder Spec.md` §7). The parts stay inside this package, as the Sheet's do.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Plan } from "@elaraai/e3-ui/internal";
import type { Slice } from "@elaraai/east-ui/internal";
import type { EditIssue, EditSession, HistoryAction, HistoryBarProps } from "@elaraai/east-ui-components";
import type { PlanScale } from "../scale.js";
import type { PlanGrain, RowKey } from "../plan-state.js";
import type { PlanEventEditing } from "../edit/events.js";
import type { PlanSearch } from "../use-seek.js";
import type { PlanWords } from "../words.js";
import type { PlanEntryRef } from "../use-plan-editing.js";
import type { PlanDiagnostics } from "../shell/Diagnostics.js";
import type { PlanTransport } from "../shell/transport.js";
import type { PlanCanvasInspect } from "./inspect.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
/** One decoded footer item of the author's. */
export type PlanFooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;

/** One session of the Plan's one history, as its banners show it (#1194). */
export interface PlanSessionBanner {
    /** Its key in the history. */
    readonly key: string;
    /** The session. */
    readonly session: EditSession<PlanEntryRef>;
    /** The source its banners name — an event kind's name; `undefined` for `data`'s, which names none. */
    readonly name: string | undefined;
    /** Where one of its issues is, in the reader's words: `data`'s row, an event's title. */
    readonly where: (issue: EditIssue) => string;
    /** Its banners' actions, on this session alone: Retry sends its request or reads its result again, Discard drops its drafts. */
    readonly onAction: (action: HistoryAction) => void;
}

/** The facts the frame's chrome is drawn from, in the canvas's words. */
export interface PlanChrome {
    /** The canvas's words: its locale and message table (#820). */
    words: PlanWords;
    /** The canvas's resolved `plan` recipe styles. */
    styles: Styles;
    /** The canvas's storage key. */
    storageKey: string;
    /** The scale every row positions against: the window the counts are read over, and the active resolution. */
    scale: PlanScale;
    /** The bound slice handle, when there is one. */
    slice: SliceBindValue | undefined;
    /** The declared affordance kinds (decoded `SliceChromeType`). */
    affordances: readonly string[];
    /** The resolutions the resolution segment offers — `[]`, no segment. */
    resolutions: readonly string[];
    /** The active grain, when the canvas has a root group for it to fold: the GROUP · RESOURCE segment (#632). */
    grain: PlanGrain | undefined;
    /** A paged source's transport state; `undefined` on an inline canvas. */
    transport: PlanTransport | undefined;
    /** Key search over the source, when a paged source declares `seek` (#574). */
    search: PlanSearch | undefined;
    /** What the canvas carried on past (#811). */
    diagnostics: PlanDiagnostics;
    /**
     * The history item's props, when the Plan edits — its root declares
     * editing (#880), or it has event kinds (#1194): its session the Plan's
     * one history across `data`'s session and each kind's, its words and its
     * actions.
     */
    history: HistoryBarProps<PlanEntryRef> | undefined;
    /** The sessions the history holds, in order — `data`'s, then each event kind's — each as its banners show it (#1194). */
    sessions: readonly PlanSessionBanner[];
    /** The event kinds' editing (#1194): their drafts, and their gestures; `undefined` for a Plan without event kinds. */
    events: PlanEventEditing | undefined;
    /** Where one of the session's issues is: its entry's first row on the canvas, by name. */
    where: (issue: EditIssue) => string;
    /** The author's footer items, in order. */
    footer: readonly PlanFooterItemValue[];
    /** The root's `id`: what the Plan's viewer state is kept under (`planKeys`). */
    id: string | undefined;
    /** Whether the canvas draws its narrow layout (§10): the footer's items then wrap. */
    narrow: boolean;
    /** What the inspector reads of the rows (#1197): a row by its key, and what a measure draws at a bucket. */
    inspect: PlanCanvasInspect;
    /**
     * Selects events from outside the canvas (#1198) — the overlaps chip's
     * first pair, a peer the inspector's banner names, a duplicate the
     * inspector made (#1194) — by their elements' keys: the selection replaced
     * by them, on the row given, else the row that draws the first, which is
     * brought into view.
     */
    selectEvents: (keys: readonly string[], row?: RowKey) => void;
    /**
     * Whether a card from the library panel's own tabs has a row to land on
     * (#1259): a row on the canvas whose series makes an item of a dropped
     * card, the canvas taking cards, outside the narrow layout. The panel's
     * author tabs let their cards drag by it.
     */
    takesCards: boolean;
}

/** What the canvas hands the frame it renders in. */
export interface PlanCanvasParts {
    /**
     * Wraps what the frame draws in the canvas's contexts — its words,
     * controller, geometry, scale, cursor, resolvers, grid and moves — and its
     * declared density, so the toolbar's items, the banners and the footer
     * speak as the canvas does.
     */
    provide(children: ReactNode): ReactNode;
    /**
     * Main: the canvas — its header (the horizon brush, the ruler, the pinned
     * rows and the focus bar), its rows, or the narrow layout's tabs and
     * cards below 480px, and its overlays — or, with no window, why.
     */
    main: ReactNode;
    /**
     * The canvas's geometry (#817), as the CSS variables its recipe reads:
     * written once, around the whole frame, so the canvas, the toolbar's
     * items and the footer read one table.
     */
    vars: Readonly<Record<string, string>>;
    /**
     * The bound the canvas declares (`style.height` / `maxHeight`): the whole
     * Plan's — the frame's — as CSS sizes; `undefined` while it grows with its
     * rows.
     */
    bound: { readonly height: string | undefined; readonly maxHeight: string | undefined } | undefined;
    /** What the frame's chrome is drawn from; `undefined` with no window, which leaves the frame main alone. */
    chrome: PlanChrome | undefined;
}

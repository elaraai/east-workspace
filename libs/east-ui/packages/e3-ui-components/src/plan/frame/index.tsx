/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraPlan` — the Plan (#1193, `Plan Builder Spec.md` §7, §7.1, §8,
 * PB19–PB25): the one Plan, laid out in `BuilderFrame` wherever it is used.
 * There is no other Plan: no canvas without the frame, and no toolbar but its
 * one.
 *
 * The canvas (`usePlanCanvas`, `../canvas.tsx`) hands the frame main and the
 * facts its chrome is drawn from, and the frame places them in its regions:
 *
 * - **the toolbar** — the Plan's items (`usePlanToolbarItems`) on the frame's
 *   one folding row, in §7.1's order: the slice's narrowing, the scope badge,
 *   the key search, the grain, the slice's range, the resolution and the
 *   diagnostics; at the row's end the summary, the review — its summary with
 *   Reject all, Rerun and Approve all, moved here from the review foot — and
 *   the history item, which leaves its error to the banners. A Plan with none
 *   of them has no toolbar. ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in
 *   the frame, never while typing;
 * - **the banners** — the editing session's (`SessionBanners`): an Apply's
 *   conflict, naming its rows; a refusal, with its reasons; a write with no
 *   answer, with Retry; an Apply whose result could not be read back, with
 *   Retry; and the drafts the source moved under, with Discard. Each leaves
 *   when what it reports does;
 * - **main** — the canvas, unchanged: the horizon brush, the ruler and the
 *   now line, the pinned rows, the rows — or, below 480px of main, the
 *   narrow layout's tabs and cards — the links and the overlays;
 * - **the footer** — the event kinds' counts (the events in the window, the
 *   backlog, the events to review, and when a kind's record was last saved),
 *   the changes waiting on Apply, the author's items, and a paged canvas's
 *   transport line;
 * - **the panes** — none yet: the library (#1195) and the inspector (#1197)
 *   are optional props, and their open tab and collapsed state persist under
 *   the Plan's `id` (`planKeys(id).frame`).
 *
 * A declared `style.height` / `maxHeight` is the whole Plan's: the frame
 * takes it, and the canvas fills main. Without one, the frame fills its
 * parent when the parent gives it a height, the canvas filling main, and
 * grows with its canvas when the parent grows with what it holds. The Plan
 * draws no border of its own.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, type KeyboardEvent } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Plan, PlanComponent, PlanEventBlocksType, PlanPayloadType, planKeys } from "@elaraai/e3-ui/internal";
import { BuilderFrame, SessionBanners, historyShortcut, implementUIComponent, typedInto } from "@elaraai/east-ui-components";
import { usePlanCanvas } from "../canvas.js";
import type { PlanCanvasParts } from "../root/chrome.js";
import type { PlanEventRows } from "../root/events.js";
import { usePlanToolbarItems } from "../shell/Toolbar.js";
import { PlanFooter } from "../shell/Footer.js";
import type { PlanRootValue } from "../model.js";
import { usePlanEventCounts } from "./counts.js";

/** The Plan's payload, decoded — what `<Plan>` returns through the `Plan` carrier (#1191). */
export type PlanValue = ValueTypeOf<typeof PlanPayloadType>;

/** The Plan's event kinds, as its payload carries them (#1190). */
type PlanEventKinds = PlanValue["events"];

type Styles = Record<string, Record<string, unknown>>;

// The memo compares CLOSURES too (#809). A Plan root is function-heavy — the
// resolvers, the element callbacks, a paged source's `page` wrapping its
// series — and `equalFor` calls every pair of functions equal, so a root that
// differed only inside one (a resolver over new data, a series `match` over a
// new threshold) was dropped and the canvas rendered the old closures.
const planRootEqual = equivalentFor(Plan.Types.Root);
/** Whether two event-rows seams read the same rows: their functions by their IR and what they capture (#809). */
const eventBlocksEquivalent = equivalentFor(PlanEventBlocksType);
/** Whether two lists of event kinds read the same records, their seams compared by their IR and what they capture. */
const eventKindsEquivalent = equivalentFor(PlanPayloadType.fields.events);
/** The payload's equivalence: its data, and its functions by their IR and what they capture (#809). */
const planPayloadEqual = equivalentFor(PlanPayloadType);

/** No event kinds: a Plan of `data` and `rows` alone. */
const NO_KINDS: PlanEventKinds = [];

/** Whether two event-rows props read the same rows. */
function sameEventRows(a: PlanEventRows | undefined, b: PlanEventRows | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.count === b.count && eventBlocksEquivalent(a.blocks, b.blocks);
}

/** Props of {@link EastChakraPlan}. */
export interface EastChakraPlanProps {
    /** The Plan root value: the canvas whole. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
    /** The event kinds' rows (#1192), drawn ahead of the root's own — a Plan of event kinds' payload carries them. */
    events?: PlanEventRows | undefined;
    /** The event kinds themselves (#1190), which the footer counts — a Plan of event kinds' payload carries them. */
    kinds?: PlanEventKinds | undefined;
}

/**
 * Renders the Plan in its frame — see the module docs.
 *
 * @param props - The root, its storage key, and the event kinds and their rows
 * @returns The Plan, in its frame
 */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey, events, kinds }: EastChakraPlanProps) {
    const canvas = usePlanCanvas({ value, storageKey, events });
    return <>{canvas.provide(<PlanFrame canvas={canvas} kinds={kinds ?? NO_KINDS} />)}</>;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey
    && sameEventRows(prev.events, next.events)
    && (prev.kinds === next.kinds || eventKindsEquivalent(prev.kinds ?? NO_KINDS, next.kinds ?? NO_KINDS)));

/** Props of {@link PlanFrame}. */
interface PlanFrameProps {
    /** What the canvas hands its frame. */
    canvas: PlanCanvasParts;
    /** The Plan's event kinds — none for a Plan of `data` and `rows` alone. */
    kinds: PlanEventKinds;
}

/** The frame, its regions holding the canvas and its chrome — inside the canvas's contexts. */
function PlanFrame({ canvas, kinds }: PlanFrameProps) {
    const { chrome, main, bound, vars } = canvas;
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = useMemo(() => recipe() as unknown as Styles, [recipe]);
    const keys = useMemo(() => planKeys(chrome?.id), [chrome?.id]);
    const items = usePlanToolbarItems(chrome);
    const counts = usePlanEventCounts(kinds, chrome?.scale);
    const history = chrome?.history;
    const session = history?.session;
    const onAction = history?.onAction;
    // The history keys from anywhere in the frame: the canvas's own it has answered already.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (onAction === undefined || event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [onAction]);
    // A Plan with no control to show — no slice, no search, no group to fold, no review, no editing — draws no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
    const banners = chrome !== undefined && history !== undefined && session !== undefined
        ? <SessionBanners session={session} words={chrome.words} onAction={history.onAction} where={chrome.where} />
        : undefined;
    const footer = chrome !== undefined
        ? <PlanFooter styles={chrome.styles} items={chrome.footer} transport={chrome.transport}
            counts={kinds.length > 0 ? counts : undefined} pending={session?.pending} narrow={chrome.narrow} />
        : undefined;
    return (
        <Box css={styles.frame} data-plan-frame="" data-plan-bound={bound !== undefined ? "" : undefined}
            style={{ ...vars, height: bound?.height, maxHeight: bound?.maxHeight }}>
            <BuilderFrame
                storageKey={keys.frame}
                toolbar={toolbar}
                banners={banners}
                footer={footer}
                onKeyDown={onKeyDown}
            >
                {main}
            </BuilderFrame>
        </Box>
    );
}

/** Props of {@link EastChakraPlanPayload}. */
export interface EastChakraPlanPayloadProps {
    /** The payload, decoded. */
    value: PlanValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/**
 * Renders a Plan's payload (#1191): its canvas, `plan`, in its frame
 * ({@link EastChakraPlan}), with its event kinds' rows ahead of the canvas's
 * own (#1192) — one block per resource kind, then the Unassigned rows' — and
 * its event kinds counted in the footer.
 *
 * @param props - The payload and its storage key
 * @returns The Plan, in its frame
 */
export const EastChakraPlanPayload = memo(function EastChakraPlanPayload({ value, storageKey }: EastChakraPlanPayloadProps) {
    const resourceKinds = value.resources.length;
    const events = useMemo(
        (): PlanEventRows | undefined => (value.blocks.type === "some" ? { blocks: value.blocks.value, count: resourceKinds + 1 } : undefined),
        [value.blocks, resourceKinds]);
    return <EastChakraPlan value={value.plan} storageKey={storageKey} events={events} kinds={value.events} />;
}, (prev, next) => planPayloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(PlanComponent, EastChakraPlanPayload);

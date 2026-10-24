/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraSchematic` — the Schematic (#1384, #1386, #1387, `Schematic
 * Builder Spec.md` §6): the one Schematic, laid out in its `BuilderFrame`
 * wherever it is used, as the Flowchart is. There is no other Schematic: no
 * canvas without the frame, and no toolbar but its one.
 *
 * It registers itself against the `Schematic` extension
 * (`Schematic.Component`) as the module loads. It draws the app's own records
 * (#1386): its reader (`data.ts`), in a component of its own, reads each
 * kind's rows and hands the frame what the canvas draws (`canvas/drawn.ts`),
 * each entity named by its kind's slot and its key. The frame places its parts
 * in its regions over one shared state — what was read, the tool held, what
 * the layers do, and whether anything is selected:
 *
 * - **the toolbar** — the Schematic's items (`useSchematicToolbarItems`,
 *   `toolbar.tsx`) on the frame's one folding row, in §6.1's order: the rail
 *   over its `Slice.bindRecords` and its summary, the tools, Zoom − / + and
 *   Fit, Find over every item kind's record by key (`find.ts`, #1404) — a pick
 *   the canvas doesn't show as itself flown to where it stands, the footer
 *   saying why — and the steps through the items while something is selected.
 *   The tool held and the link kind Connect draws are the viewer's, kept under
 *   the Schematic's `id` (`tools.ts`). ⌘F, or Ctrl+F, anywhere in the frame
 *   focuses Find;
 * - **main** — the canvas (`canvas/view.tsx`), filling main, the minimap and
 *   the scale bar on it and no control of its own; the toolbar drives its
 *   camera and its steps through its handle;
 * - **the footer** — only what is live (`footer.tsx`): a kind drawn as its
 *   density, how many rows it shades in the view; why a gesture was refused;
 *   each Save's notice; and where Find's last pick landed off the canvas, why.
 *   The drawing's counts and each record's last save are the inspector's
 *   (`counts.ts`), the changes waiting on Save the history's;
 * - **the banners** — each record's session's (`SessionBanners`), titled by
 *   its kind, and each source the library follows whose narrowing could not be
 *   read, with Retry. A kind's read that fails is said once where it happened
 *   (#1398, CL11): on the canvas, at the top-left in view of the area it failed
 *   reading — the canvas's own top-left for a kind read whole or the drawing's
 *   read — with Retry, and in the footer's line: a kind read through its
 *   source of the slice asks the source again, and one read whole is read
 *   again;
 * - **the library** — the start pane, when `library` lists a tab (#1389,
 *   `library.tsx`): every kind's templates, the item kinds' backlog, the
 *   zones' Index — the zone the viewport is in marked, a row's click flying
 *   to what it names — the Layers tab, whose choices the canvas obeys
 *   (`layers-view.ts`), and the author's tabs, each following the source of
 *   the rail it names (`FollowSources`), whose failed narrowing is a banner
 *   with Retry. Which card each tab has selected is the frame's: the
 *   template selected is what a Connect's new link or net takes its fields
 *   from (§4.3);
 * - **the drops** (#1390, `use-drop.ts`): the library's cards land on the
 *   canvas, the Schematic's drop target — an item template adding an item
 *   where it lands, a backlog row placed there, a link or net template
 *   writing its values over a link or a net of its kind, an author's card
 *   setting its fields on an entity of the kind its patch names — each one
 *   step of the history, an item it adds or places selected; ⏎ on a card,
 *   and on a touch screen a tap on the selected card, drops it on the
 *   selection or at the view's centre, and where that is refused the footer
 *   says why;
 * - **the inspector** (#1391, `inspector.tsx`): the end pane, given
 *   `inspector` — Details of what is selected (`inspect.ts`), its rows read in
 *   a component of their own (`inspector-rows.ts`), every edit one step of the
 *   history; and Issues (`issues.ts`), each selecting what it names. Enter, or
 *   a double-click on an entity, opens Details, its open tab kept per viewer;
 * - **the narrowing** (#1392, `narrowing.ts`): each kind's source of the rail,
 *   its shown keys followed while the narrowing dims or looks at its matches,
 *   hiding what it leaves out or drawing it as context; every list — the
 *   Index, the Backlog, the Choosers, what an item is joined to — and every
 *   count shows what it leaves in, Find marks what it leaves out, and the
 *   canvas rings, frames and flies to its matches;
 * - **the skeleton** — `BuilderFrame.loading` covers the frame until every
 *   kind has been read once (or its read failed); later reads keep the canvas
 *   and what it draws until they land, main `aria-busy` meanwhile
 *   (`BuilderFrame.busy`, #1398 CL12), as it is while a narrowing resolves
 *   (§6.5, §10.4) — the canvas washing the area a window's read has not drawn
 *   yet, and a card whose details are read holding their places (CL2); the
 *   footer's line saying what is read (CL3); each placeholder and the line on
 *   the frame's one reveal clock (CL4), the inspector's reads among what it
 *   waits on.
 *
 * Every gesture is one step of one history over a session per record the
 * Schematic writes (`editing.ts`, #1388): the canvas records each gesture's
 * edits (`edits.ts`), and draws the stored rows with the drafts in place
 * (`drafted.ts`). The history item ends the toolbar while a record is edited —
 * Undo, Redo, Discard and Save — and ⌘Z, ⇧⌘Z and ⌘Y take it anywhere in the
 * frame but a field typed into.
 *
 * The layers hide, lock and dim the entities on them as their author defaults
 * say (`canvas/layers.ts`), and the viewer's choices in the Layers tab over
 * them, kept under the Schematic's `id`. The host hears the whole selection through
 * `onSelect`, and vets a connection through `canConnect` (#1401, D34). The
 * Schematic fills the box it is given and draws no border: a host gives it a
 * box of its own height.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { ArrayType, StringType, equalFor, equivalentFor, none, some, type option } from "@elaraai/east";
import { Schematic, schematicAreaIndexes, schematicKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, focusKeySearch, getSomeorUndefined, historyShortcut, historyToolbarItem,
    implementUIComponent, typedInto, useDataStable, useFormatters, usePersistedState, useSlicesReactivity, type EditIssue, type EditingWords, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, loadingLineText, schematicColorTokens, type LoadingLineText, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { rowCodec } from "../shared/schedule/records.js";
import { sourcePart, type KeyVisibilityWords, type SourcesChrome } from "../shared/schedule/visibility.js";
import { createViewportStore, type SchematicViewportStore } from "./area.js";
import { backlogEntries } from "./backlog.js";
import { SchematicBacklogPages, type BacklogAreaKind, type BacklogPageCount } from "./backlog-pages.js";
import {
    SchematicCanvas, type SchematicCanvasEditing, type SchematicCanvasFailure, type SchematicCanvasHandle, type SchematicCanvasNarrowing, type SchematicZoomRange,
} from "./canvas/view.js";
import { entityId, refOfId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type ItemRoles, type SchematicRef } from "./canvas/drawn.js";
import { layerState } from "./canvas/layers.js";
import { hostZones, zoneHolding } from "./canvas/model.js";
import { INITIAL_SCHEMATIC_DATA, SchematicDataReader, areaSlots, type SchematicData, type SchematicValue } from "./data.js";
import { savedRecords, schematicCounts } from "./counts.js";
import { draftedDrawing, type DraftedCache } from "./drafted.js";
import type { SchematicDropContext, SchematicDropKind } from "./drop.js";
import type { NetLeg, SchematicEdit } from "./edits.js";
import { recordSlot, useSchematicEditing } from "./editing.js";
import { foundMark, useSchematicFind, type FindKind, type FoundItem } from "./find.js";
import { SchematicFooter, type SchematicFoundNotice, type SchematicNotice } from "./footer.js";
import { drawnEntities, inspectedEqual, inspectedOf } from "./inspect.js";
import { schematicInspectorPane } from "./inspector.js";
import { NO_INSPECTED_ROWS, SchematicInspectedReader, type SchematicInspectedRows } from "./inspector-rows.js";
import { drawingIssues, sessionIssues } from "./issues.js";
import { SchematicIndexArea, type IndexAreaKind } from "./index-area.js";
import { KindRows } from "./kind-rows.js";
import { layersInForce, useSchematicLayerView } from "./layers-view.js";
import { SchematicBacklogCountReader, schematicLibraryId, useSchematicLibrary, type SchematicBacklogNarrowing } from "./library.js";
import { schematicMessages, type SchematicWords } from "./messages.js";
import { looksAtMatches, narrowedDrawing, narrowedLook, schematicNarrowing, type SchematicNarrowedLook } from "./narrowing.js";
import { useSchematicToolbarItems } from "./toolbar.js";
import { offeredTools, toolsInForce, useSchematicTools } from "./tools.js";
import { useSchematicDrop } from "./use-drop.js";

type Styles = Record<string, SystemStyleObject>;

// The memo compares closures too (#809): a payload whose functions captured new
// data is a new payload, which the reader reads again; what it draws keeps its
// identity while nothing it shows moves, so an in-progress edit or the camera
// is never replaced by a closure-only change.
const schematicEqual = equivalentFor(Schematic.Types.Payload);
const layersEqual = equalFor(ArrayType(Schematic.Types.Layer));
const narrowedEqual = equalFor(Schematic.Types.Narrowed);
const stringEqual = equalFor(StringType);

export type { SchematicValue } from "./data.js";

/** An item as the canvas draws it. */
export type SchematicItemValue = DrawnItem;

/** A zone as the canvas draws it. */
export type SchematicZoneValue = DrawnZone;

/** A link as the canvas draws it. */
export type SchematicLinkValue = DrawnLink;

/** A net (bus / trunk) as the canvas draws it. */
export type SchematicNetValue = DrawnNet;

/** The props `EastChakraSchematic` takes: the payload and its structural storage key. */
export interface EastChakraSchematicProps {
    /** The payload, decoded. */
    value: SchematicValue;
    /**
     * The structural storage key: the editing's sessions are kept under it and the Schematic's `id` (#1388), and the
     * frame keeps its panes under the `id` (`schematicKeys(id).frame`).
     */
    storageKey: string;
}

/**
 * Renders the Schematic (e3-ui's `<Schematic>`): its reader, which reads each
 * kind's rows (`data.ts`), and its frame, which lays the canvas and its chrome
 * out over what it read — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The Schematic, in its frame
 */
export const EastChakraSchematic = memo(function EastChakraSchematic({ value, storageKey }: EastChakraSchematicProps) {
    const [data, setData] = useState<SchematicData>(INITIAL_SCHEMATIC_DATA);
    // A Retry of a kind read whole reads every kind again: the read's attempt moves.
    const [attempt, setAttempt] = useState(0);
    const readAgain = useCallback(() => setAttempt((n) => n + 1), []);
    // Where the canvas's viewport rests (#1393): the canvas writes it, the reader reads its windows around it.
    const [viewport] = useState(createViewportStore);
    return (
        <>
            <SchematicDataReader value={value} attempt={attempt} viewport={viewport} onData={setData} />
            <SchematicFollows value={value} data={data} readAgain={readAgain} storageKey={storageKey} viewport={viewport} />
        </>
    );
}, (prev, next) => schematicEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link SchematicFrame}. */
interface SchematicFrameProps {
    /** The payload, decoded. */
    readonly value: SchematicValue;
    /** What the reader has read. */
    readonly data: SchematicData;
    /** Reads every kind again: a Retry of a kind read whole. */
    readonly readAgain: () => void;
    /** The structural storage key: the editing's sessions are kept under it and the Schematic's `id`. */
    readonly storageKey: string;
    /** Where the canvas's viewport rests, which the canvas writes as its camera comes to rest (#1393). */
    readonly viewport: SchematicViewportStore;
}

/**
 * The sources of the rail the Schematic follows (#1389, #1392): each kind's
 * templates record's, each an author's tab names, and — while the narrowing
 * draws its context or its matches — each kind's read through its source;
 * each once, in order, with what the rail counts each in: a kind's templates,
 * an author's tab's name, a kind's rows.
 *
 * @param value - The payload
 * @param words - The Schematic's words
 * @param chrome - The rail; `undefined` with no slice
 * @param look - How a narrowed-out row draws, and what the matches take
 * @returns The sources, and their nouns, by name
 */
function followedSources(value: SchematicValue, words: SchematicWords, chrome: SourcesChrome | undefined, look: SchematicNarrowedLook): {
    sources: string[]; nouns: Map<string, string>;
} {
    const nouns = new Map<string, string>();
    for (const kind of [...value.items, ...value.links, ...value.nets]) {
        const source = getSomeorUndefined(kind.templatesSource);
        if (source !== undefined && !nouns.has(source)) nouns.set(source, words.m.templatesNoun({ name: kind.name.toLocaleLowerCase(words.locale) }));
    }
    for (const tab of value.library) {
        const source = tab.type === "tab" ? getSomeorUndefined(tab.value.source) : undefined;
        if (tab.type === "tab" && source !== undefined && !nouns.has(source)) nouns.set(source, tab.value.name.toLocaleLowerCase(words.locale));
    }
    // A kind's own source: its shown keys say what is context, dimmed, and what matches — read only while either draws.
    // A kind read by area asks its window's rows of its narrowing instead, never the narrowing's keys whole (D28).
    if (look.dim || looksAtMatches(look)) {
        const areas = areaSlots(value);
        for (const kind of [...value.items, ...value.zones, ...value.links, ...value.nets]) {
            if (sourcePart(chrome, kind.key) !== undefined && !areas.has(kind.key) && !nouns.has(kind.key)) {
                nouns.set(kind.key, words.m.kindNoun({ name: kind.name.toLocaleLowerCase(words.locale), plural: true }));
            }
        }
    }
    return { sources: [...nouns.keys()], nouns };
}

/**
 * The frame, once each source it follows is read (#1389, #1392): what each
 * templates list and each author's tab shows of the source it names, and each
 * kind's matches — one component a source, so a payload naming another set
 * keeps each one's hooks in order.
 */
function SchematicFollows(props: SchematicFrameProps) {
    const { value } = props;
    const formatters = useFormatters();
    const words = useMemo((): SchematicWords => ({ ...formatters, m: schematicMessages }), [formatters]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const narrowed = useDataStable(value.narrowed, narrowedEqual);
    const look = useMemo(() => narrowedLook(narrowed), [narrowed]);
    const { sources, nouns } = useMemo(() => followedSources(value, words, chrome, look), [value, words, chrome, look]);
    // What a source's failed narrowing says, in the Schematic's words.
    const said = useCallback((name: string): KeyVisibilityWords => ({ changed: words.m.sourceChanged({ name }), failed: words.m.sourceFailed({ name }) }), [words]);
    return (
        <FollowSources chrome={chrome} narrowed={value.shown} sources={sources} nouns={nouns} said={said}>
            {(followed) => <SchematicFrame {...props} followed={followed} look={look} />}
        </FollowSources>
    );
}

/** No entity selected. */
const NOTHING_SELECTED: ReadonlySet<string> = new Set();

/** No card of the library selected. */
const NO_PICKS: ReadonlyMap<string, string> = new Map();

/** The zoom as the canvas opens: at Fit. */
const AT_FIT: SchematicZoomRange = { atFit: true, atLimit: false };

/** The theme colour tokens a colour may name (D14): what the Issues tab holds each colour to (#1391). */
const THEME_COLOURS: ReadonlySet<string> = new Set(schematicColorTokens);

/** The frame, its regions holding the Schematic's parts over one shared state — see the module docs. */
function SchematicFrame({ value, data, readAgain, storageKey, viewport, followed, look }: SchematicFrameProps & {
    readonly followed: FollowedSources;
    readonly look: SchematicNarrowedLook;
}) {
    // The recipe's styles, resolved once a recipe: the frame renders again as each window lands.
    const recipe = useSlotRecipe({ key: "schematic" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    // The counts and the dates, in the app's locale (#850), and the Schematic's words.
    const formatters = useFormatters();
    const words = useMemo((): SchematicWords => ({ ...formatters, m: schematicMessages }), [formatters]);
    // Keyed on the id's text: each payload decodes its Option afresh, and the keys must hold while the id does.
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => schematicKeys(id), [id]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);

    // ── The editing (#1388, §7): one history over a session per record it writes ─────
    // Each kind read through its source: its Save's notice counts what leaves the source's narrowing.
    const recordSlices = useMemo(() => [...value.items, ...value.zones, ...value.links, ...value.nets].flatMap((kind) => {
        const part = kind.editable ? sourcePart(chrome, kind.key) : undefined;
        return part === undefined ? [] : [part];
    }), [value.items, value.zones, value.links, value.nets, chrome]);
    // The kinds read by area (#1393): never read whole, nor their narrowing complete.
    const areas = useMemo(() => areaSlots(value), [value]);
    // The rows of the kinds read by area that the paged Backlog and the Index read outside the window (#1393), as their
    // `rowsOf` makes them: what a gesture on one rewrites, asked as the gesture reads it.
    const [kindRows] = useState(() => new KindRows<ItemRoles>());
    const pagedRow = useCallback((slot: string, key: string) => kindRows.rowOf(slot, key), [kindRows]);
    const editing = useSchematicEditing(value, `${storageKey}.${id ?? "schematic"}`, recordSlices, data.held, areas, data.windows, pagedRow);
    const editingWords = useMemo((): EditingWords => ({ ...formatters, m: editingMessages }), [formatters]);
    // What the canvas draws: the stored rows, the drafts in place, each drafted row drawn once.
    const draftedCache = useRef<DraftedCache>(new WeakMap());
    // A kind read by area holds only its window: a drafted row of it off the window draws where its draft places it (#1393).
    const drawing = useMemo(() => draftedDrawing(data.drawn, data.held, editing.drafts, draftedCache.current, areas), [data.drawn, data.held, editing.drafts, areas]);
    const canvasEditing = useMemo((): SchematicCanvasEditing | undefined => (editing.edits ? { record: editing.record, mint: editing.mint } : undefined),
        [editing.edits, editing.record, editing.mint]);

    // ── The narrowing (#1392, §10.2, §10.3): what each kind's source of the rail leaves out, hidden or dimmed ──
    // Each kind read through its source; its shown keys once they have resolved — a pending one is not empty — `none`
    // while it narrows nothing, read while the narrowing dims or looks at its matches.
    const sourced = useMemo(() => new Set([...value.items, ...value.zones, ...value.links, ...value.nets]
        .flatMap((kind) => (sourcePart(chrome, kind.key) === undefined ? [] : [kind.key]))), [value.items, value.zones, value.links, value.nets, chrome]);
    const kindKeys = useCallback((slot: string): option<ReadonlySet<string>> | undefined => {
        // A kind read by area: which of its window's rows its narrowing holds, as `within` answered (D28).
        if (areas.has(slot)) {
            const matched = data.matched.get(slot);
            return matched === undefined ? none : some(matched);
        }
        const shown = sourced.has(slot) ? followed.get(slot)?.shown : undefined;
        return shown === undefined || (shown.keys.type === "some" && !shown.ready) ? undefined : shown.keys;
    }, [areas, data.matched, sourced, followed]);
    const narrowing = useMemo(() => schematicNarrowing({ drawn: drawing, held: data.held, sourced, keys: kindKeys, dim: look.dim }),
        [drawing, data.held, sourced, kindKeys, look.dim]);
    // The drawing as every list shows it — Find, the Index, the Choosers, what an item is joined to, the counts.
    const listed = useMemo(() => narrowedDrawing(drawing, narrowing.out), [drawing, narrowing.out]);
    const canvasNarrowing = useMemo((): SchematicCanvasNarrowing => ({ context: narrowing.context, out: narrowing.out, matches: narrowing.matches, look }),
        [narrowing, look]);
    // A kind's narrowing resolving: the frame is busy, its last membership drawn meanwhile.
    const narrowingBusy = [...sourced].some((slot) => { const one = followed.get(slot); return one !== undefined && one.shown.busy && one.error === undefined; });
    // Why the last gesture was refused, until one is recorded or Esc.
    const [refusal, setRefusal] = useState<string | undefined>(undefined);

    // ── The layers: what their author defaults and the viewer's choices hide, lock and dim (#1389) ──
    const layerValues = useDataStable(value.layers, layersEqual);
    const [layerView, setLayerView] = useSchematicLayerView(keys.layers);
    const layersNow = useMemo(() => layersInForce(layerValues, layerView), [layerValues, layerView]);
    const layers = useMemo(() => layerState(layersNow, drawing), [layersNow, drawing]);

    // ── The tools (§6.1): the viewer's, as the Schematic offers them ─────
    // Connect over a link kind bound with its patch door, Move over such an item kind; `readOnly` offers neither.
    const readOnly = value.readOnly;
    const linkChoices = useMemo(() => (readOnly ? [] : value.links.filter((kind) => kind.editable).map((kind) => ({ key: kind.key, name: kind.name }))),
        [readOnly, value.links]);
    const movable = !readOnly && value.items.some((kind) => kind.editable);
    const linkSlots = useMemo(() => linkChoices.map((link) => link.key).join("\u0000"), [linkChoices]);
    const offered = useMemo(() => ({ links: linkSlots === "" ? [] : linkSlots.split("\u0000"), movable }), [linkSlots, movable]);
    const [stored, pickTools] = useSchematicTools(keys.tools);
    const held = useMemo(() => toolsInForce(stored, offered), [stored, offered]);
    const tools = useMemo(() => offeredTools(offered), [offered]);

    // ── The canvas: the camera and the selection are its own ────────────
    const canvasRef = useRef<SchematicCanvasHandle>(null);
    // What the canvas has selected, by id: the toolbar's steps show while something is, the Index marks its rows, and
    // the inspector shows it — a net's leg with it (#1391).
    const [selection, setSelection] = useState<ReadonlySet<string>>(NOTHING_SELECTED);
    const [leg, setLeg] = useState<NetLeg | null>(null);
    // Why the item Find's last pick landed on doesn't show as itself — the filters, its layer, no position — until the
    // next pick, Clear filters or a selection (#1404).
    const [found, setFound] = useState<SchematicFoundNotice | undefined>(undefined);
    const onSelection = useCallback((ids: ReadonlySet<string>, next: NetLeg | null) => {
        setSelection(ids);
        setLeg(next);
        // A selection says no more where Find's last pick landed (#1404).
        if (ids.size > 0) setFound(undefined);
    }, []);
    const selected = selection.size > 0;
    // Where the zoom stands, as the canvas tells it: the toolbar's Zoom out and Zoom in take no press past either end (#1393).
    const [zoomRange, setZoomRange] = useState<SchematicZoomRange>(AT_FIT);
    const zoomBy = useCallback((factor: number) => canvasRef.current?.zoomBy(factor), []);
    const fit = useCallback(() => canvasRef.current?.fit(), []);
    const step = useCallback((delta: 1 | -1) => canvasRef.current?.step(delta), []);

    // ── The library's selected cards (#1389, #1390): each card tab's, by the tab's key ──
    // A click selects a card, and a click on the selected one lets it go.
    const [picked, setPicked] = useState<ReadonlyMap<string, string>>(NO_PICKS);
    const onPick = useCallback((tabKey: string, key: string) => {
        setPicked((was) => {
            const next = new Map(was);
            const chosen = was.get(tabKey);
            if (chosen !== undefined && stringEqual(chosen, key)) next.delete(tabKey);
            else next.set(tabKey, key);
            return next;
        });
    }, []);
    // The template the Templates tab has selected, of a link or a net kind: what a Connect's new link or net of its kind
    // takes its other fields from (§4.3).
    const pickedTemplate = useMemo(() => {
        const id = picked.get("templates");
        const ref = id === undefined ? undefined : refOfId(id);
        if (ref === undefined) return undefined;
        const kind = [...value.links, ...value.nets].find((k) => stringEqual(k.key, ref.kind));
        const template = kind?.templates.find((t) => stringEqual(t.key, ref.key));
        return kind === undefined || template === undefined ? undefined : { slot: kind.key, values: template.values };
    }, [picked, value.links, value.nets]);
    const connectValues = useCallback((slot: string): option<Uint8Array> =>
        (pickedTemplate !== undefined && stringEqual(pickedTemplate.slot, slot) ? some(pickedTemplate.values) : none), [pickedTemplate]);

    // ── Find (§6.1, #1404): every item kind's record, by key — one read through its source sought through e3 ─────
    const findKinds = useMemo((): FindKind[] => value.items.map((kind) => ({
        slot: kind.key, name: kind.name, part: sourcePart(chrome, kind.key), rows: kind.rows, read: kind.read, codec: rowCodec(kind.rowType),
    })), [value.items, chrome]);
    const reveal = useCallback((entity: string) => canvasRef.current?.reveal(entity), []);
    const hiddenLayers = useMemo(() => new Set(layersNow.flatMap((layer) => (getSomeorUndefined(layer.visible) === false ? [layer.key] : []))), [layersNow]);
    const drawnItems = useMemo(() => new Set(drawing.items.map((item) => item.key)), [drawing.items]);
    const onFound = useCallback((item: FoundItem) => {
        const canvas = canvasRef.current;
        const mark = foundMark(item, look.dim, hiddenLayers);
        if (mark === undefined) {
            setFound(undefined);
            // The narrowing holds it: drawn, it is flown to and selected; not drawn yet — off a window (#1393) — flown to,
            // and selected once it draws.
            if (drawnItems.has(item.id) || item.position === undefined) canvas?.reveal(item.id);
            else { canvas?.look(item.position.x, item.position.y); canvas?.select(item.id); }
            return;
        }
        // Drawn as context, it is flown to as any is, selecting nothing; else the camera flies to where it stands.
        if (mark === "dimmed" && drawnItems.has(item.id)) canvas?.reveal(item.id);
        else if (item.position !== undefined) canvas?.look(item.position.x, item.position.y);
        // Its kind's source's filters leave it out: their Clear clears them, and selects it once it draws.
        const part = mark === "hidden" || mark === "dimmed" ? sourcePart(chrome, item.ref.kind) : undefined;
        setFound({
            words: words.m.foundOff({ item: item.label, mark }),
            clear: part === undefined ? undefined : () => { part.clearAll(); setFound(undefined); canvasRef.current?.select(item.id); },
        });
    }, [look.dim, hiddenLayers, drawnItems, chrome, words]);
    const find = useSchematicFind({ kinds: findKinds, words, dim: look.dim, hiddenLayers, onPick: onFound });

    // ── The toolbar (§6.1) ──────────────────────────────────────────────
    // What the rail counts a source in: a templates list's, its kind's templates; a kind's own, its rows (#1392).
    const nouns = useMemo(() => {
        const named: Record<string, string> = {};
        for (const kind of [...value.items, ...value.links, ...value.nets]) {
            const source = getSomeorUndefined(kind.templatesSource);
            if (source !== undefined && named[source] === undefined) named[source] = words.m.templatesNoun({ name: kind.name.toLocaleLowerCase(words.locale) });
        }
        for (const kind of [...value.items, ...value.zones, ...value.links, ...value.nets]) {
            if (named[kind.key] === undefined && sourcePart(chrome, kind.key) !== undefined) {
                named[kind.key] = words.m.kindNoun({ name: kind.name.toLocaleLowerCase(words.locale), plural: true });
            }
        }
        return named;
    }, [value.items, value.zones, value.links, value.nets, chrome, words]);
    const toolbarRef = useRef<HTMLDivElement>(null);
    // The history's acts: whatever has the focus lets it go first — a field commits what it holds.
    const history = editing.history;
    const onAction = useCallback((action: HistoryAction) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        history.act(action);
    }, [history]);
    // An issue a Save raised: the canvas flies to the item it names, and selects it.
    const sessions = editing.schedule.sessions;
    const onIssue = useCallback((issue: EditIssue) => {
        const key = history.sourceOf(issue);
        const part = key === undefined ? undefined : sessions.find((held) => stringEqual(held.key, key));
        if (part !== undefined) reveal(entityId({ kind: recordSlot(part.kind), key: issue.entry }));
    }, [history, sessions, reveal]);
    const historyItem = editing.edits
        ? historyToolbarItem({ session: history, words: editingWords, editing: false, showError: false, onIssue, onAction })
        : undefined;
    const items = useSchematicToolbarItems({
        styles, words, chrome, nouns, tools, held, links: linkChoices, onTools: pickTools, find,
        onZoom: zoomBy, zoom: zoomRange, onFit: fit, selected, onStep: step, history: historyItem,
    });
    // ⌘F, or Ctrl+F, anywhere in the frame: Find, in whichever form the row holds it; ⌘Z, ⇧⌘Z and ⌘Y the history's,
    // but in a field typed into, whose own they are.
    const edits = editing.edits;
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
            if (focusKeySearch(toolbarRef.current)) event.preventDefault();
            return;
        }
        const action = historyShortcut(event);
        if (action === undefined || !edits || typedInto(event.target)) return;
        event.preventDefault();
        onAction(action);
    }, [edits, onAction]);

    // ── The library (#1389, §8): the start pane, when `library` lists a tab ──
    // Every item kind's rows with no position, the drafts in place: the Backlog's — dimmed, its context left out (#1392).
    const backlog = useMemo(() => backlogEntries(value.items, data.unplaced, data.held, editing.drafts.items).filter((entry) => !narrowing.isContext(entry.ref)),
        [value.items, data.unplaced, data.held, editing.drafts.items, narrowing]);
    // An item kind with a backlog read through its source: while the rail narrows one, the Backlog says so, with Clear filters.
    const backlogParts = useMemo(() => value.items.flatMap((kind) => {
        const part = kind.backlog ? sourcePart(chrome, kind.key) : undefined;
        return part === undefined ? [] : [part];
    }), [value.items, chrome]);
    const backlogVersion = useSlicesReactivity(backlogParts.map((part) => part.key));
    const backlogNarrowing = useMemo((): SchematicBacklogNarrowing => {
        const narrowing = backlogParts.filter((part) => part.read().where.size > 0);
        return { narrows: narrowing.length > 0, clear: narrowing.length === 0 ? undefined : () => { for (const part of narrowing) part.clearAll(); } };
        // `backlogVersion` moves with each source's choices.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backlogParts, backlogVersion]);
    // The item kinds read by area (#1393): what the Backlog pages and the Index reads of them outside their window. A kind
    // whose area indexes are refused the reader says so of, with Retry, and reads no further: neither reads it.
    const areaItemKinds = useMemo(() => value.items.flatMap((kind): IndexAreaKind[] => {
        const part = areas.has(kind.key) ? sourcePart(chrome, kind.key) : undefined;
        if (part === undefined) return [];
        try {
            const indexes = schematicAreaIndexes(part.config.indexes, kind.box, "items", `Schematic.items: "${kind.name}"`);
            return indexes === undefined ? [] : [{ kind, part, areas: indexes }];
        } catch {
            return [];
        }
    }), [value.items, areas, chrome]);
    // Those with a backlog (D51): their rows with no position paged through their area index's unplaced clause, the
    // Backlog one paged list.
    const backlogAreaKinds = useMemo((): BacklogAreaKind[] => areaItemKinds.filter(({ kind }) => kind.backlog), [areaItemKinds]);
    const pagesBacklog = backlogAreaKinds.length > 0 && value.library.some((tab) => tab.type === "backlog");
    const backlogPages = useMemo(() => (!pagesBacklog ? undefined
        : new SchematicBacklogPages(schematicLibraryId(keys, "backlog"), backlog, backlogAreaKinds, editing.drafts.items, kindRows)),
    [pagesBacklog, keys, backlog, backlogAreaKinds, editing.drafts.items, kindRows]);
    const backlogPartKeys = useMemo(() => backlogAreaKinds.map(({ part }) => part.key), [backlogAreaKinds]);
    // Its count, read in a component of its own; and what a card of it drops.
    const [backlogCount, setBacklogCount] = useState<BacklogPageCount | undefined>(undefined);
    const backlogPaged = useMemo(() => (backlogPages === undefined ? undefined : { source: backlogPages, count: backlogCount }), [backlogPages, backlogCount]);
    const pagedBacklog = useMemo(() => (backlogPages === undefined ? undefined : (id: string) => backlogPages.card(id)), [backlogPages]);
    // The Index's zones and items: what the canvas draws, a hidden layer's and what the narrowing leaves out left out.
    const shownZones = useMemo(() => (layers.hidden.size === 0 ? listed.zones : listed.zones.filter((zone) => !layers.hidden.has(zone.key))), [listed.zones, layers.hidden]);
    const shownItems = useMemo(() => (layers.hidden.size === 0 ? listed.items : listed.items.filter((item) => !layers.hidden.has(item.key))), [listed.items, layers.hidden]);
    // How many entities each layer holds: every one on it, shown or hidden.
    const layerCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const entity of [...drawing.items, ...drawing.zones, ...drawing.links, ...drawing.nets]) {
            const on = getSomeorUndefined(entity.layer);
            if (on !== undefined) counts.set(on, (counts.get(on) ?? 0) + 1);
        }
        return counts;
    }, [drawing]);
    // The zone the viewport is in, which the Index marks: the canvas tells it only while the library lists the Index.
    const [inView, setInView] = useState<string | undefined>(undefined);
    const listsIndex = value.library.some((tab) => tab.type === "index");
    // The Index's reads of the item kinds read by area (D52): an open zone's items by its box, and the search's.
    const [indexReader] = useState(() => new SchematicIndexArea(kindRows));
    const indexArea = useMemo(() => (!listsIndex || areaItemKinds.length === 0 ? undefined
        : { kinds: areaItemKinds, reader: indexReader, hiddenLayers }), [listsIndex, areaItemKinds, indexReader, hiddenLayers]);

    // ── The drops (#1390, §7, §8): the library's cards, onto the canvas ──
    // Each kind, as a drop reads it: its name, and whether it writes — bound with its patch door, the Schematic not read only.
    const dropKinds = useMemo(() => new Map<string, SchematicDropKind>([...value.items, ...value.zones, ...value.links, ...value.nets]
        .map((kind) => [kind.key, { name: kind.name, writes: kind.editable && !value.readOnly }] as const)),
    [value.items, value.zones, value.links, value.nets, value.readOnly]);
    // Each entity's name, as a drop's words say it: an item's or a zone's label, a link's ends, a net's label or its key.
    const names = useMemo(() => {
        const out = new Map<string, string>();
        for (const item of drawing.items) out.set(item.key, item.label);
        for (const zone of drawing.zones) out.set(zone.key, zone.label);
        const end = (id: string) => out.get(id) ?? refOfId(id)?.key ?? id;
        for (const link of drawing.links) out.set(link.key, words.m.linkEnds({ from: end(link.from), to: end(link.to) }));
        for (const net of drawing.nets) out.set(net.key, getSomeorUndefined(net.label) ?? net.ref.key);
        return out;
    }, [drawing, words]);
    // The zones a point lands in, smallest first, as the Index files an item: what a drop's words name.
    const hosts = useMemo(() => hostZones(shownZones), [shownZones]);
    const editingNow = editing.schedule;
    const dropContext = useCallback((): SchematicDropContext => ({
        extent: value.extent,
        kinds: dropKinds,
        available: (slot) => editingNow.available(slot),
        nameOf: (ref) => names.get(entityId(ref)),
        zoneAt: (point) => zoneHolding(hosts, point.x, point.y)?.label,
    }), [value.extent, dropKinds, editingNow, names, hosts]);
    const recordEdits = editing.record;
    const recordDrop = useCallback((edits: readonly SchematicEdit[], label: string) => recordEdits(edits, "drop", label), [recordEdits]);
    // What the canvas has selected, each entity by its reference: what a card's ⏎ drops on.
    const selectedRefs = useCallback((): SchematicRef[] => [...selection].flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; }), [selection]);
    const viewCentre = useCallback(() => canvasRef.current?.centre(), []);
    const selectDropped = useCallback((id: string) => canvasRef.current?.select(id), []);
    const drop = useSchematicDrop({
        value, backlog, pagedBacklog, keys, context: dropContext, record: recordDrop, mint: editing.mint, selection: selectedRefs, centre: viewCentre,
        select: selectDropped, notice: setRefusal, words, unit: getSomeorUndefined(value.scaleUnit),
    });

    const library = useSchematicLibrary({
        value, zones: shownZones, items: shownItems, backlog, backlogNarrowing, backlogPages: backlogPaged, indexArea, layers: layerValues, layerCounts, layerView,
        onLayerView: setLayerView,
        inView, selected: selection, onReveal: reveal, keys, words, followed, picked, onPick, enter: drop.enter,
    });

    // ── The drawing's counts and saves: the inspector's Details, with nothing selected (#1391) ──
    const counted = useMemo(() => ({
        items: value.items.map((kind) => ({ key: kind.key, name: kind.name })),
        zones: value.zones.length > 0, links: value.links.length > 0, nets: value.nets.length > 0,
    }), [value.items, value.zones, value.links, value.nets]);
    // What the narrowing leaves out counts nowhere: dimmed context is no match.
    const counts = useMemo(() => schematicCounts(counted, listed, layers), [counted, listed, layers]);
    const records = useMemo(() => savedRecords(value), [value]);

    // ── The footer (§6.3): only what is live ────────────────────────────
    // Each kind read through its source that writes: a Save's notice counts the rows it took out of the source's narrowing.
    const notices = useMemo((): SchematicNotice[] => [...value.items, ...value.zones, ...value.links, ...value.nets].flatMap((kind) => {
        const part = kind.editable && !value.readOnly ? sourcePart(chrome, kind.key) : undefined;
        const name = kind.name.toLocaleLowerCase(words.locale);
        return part === undefined ? [] : [{ slot: kind.key, slice: part, singular: words.m.kindNoun({ name, plural: false }), plural: words.m.kindNoun({ name, plural: true }) }];
    }), [value.items, value.zones, value.links, value.nets, value.readOnly, chrome, words]);

    // ── A read that failed, said once where it happened (#1398, CL11) ──
    const kindName = useMemo(() => new Map([...value.items, ...value.zones, ...value.links, ...value.nets].map((kind) => [kind.key, kind.name] as const)),
        [value.items, value.zones, value.links, value.nets]);
    // A kind read through its source asks its source again; one read whole is read again.
    const retry = useCallback((slot: string | undefined) => {
        const part = slot === undefined ? undefined : sourcePart(chrome, slot);
        if (part !== undefined) part.retry();
        else readAgain();
    }, [chrome, readAgain]);
    // A kind's rows, as the line names them — `racks`, one `rack`.
    const nounOf = useCallback((slot: string, plural = true) => words.m.kindNoun({ name: (kindName.get(slot) ?? slot).toLocaleLowerCase(words.locale), plural }),
        [kindName, words]);
    // On the canvas, at the top-left in view of the area it failed reading — the canvas's own for a kind read whole and
    // the drawing's read — with Retry: the drawing's first, then the first kind's in the Schematic's order.
    const canvasFailure = useMemo((): SchematicCanvasFailure | undefined => {
        if (data.error !== undefined) {
            return { message: loadingLineText(words.m.lineFailed({ noun: words.m.drawingNoun(), from: undefined, to: undefined })), retry: () => retry(undefined), area: undefined };
        }
        const [failure] = data.failures;
        if (failure === undefined) return undefined;
        const [slot] = failure;
        const area = data.failedAreas.get(slot);
        const message = area !== undefined ? words.m.areaFailed() : loadingLineText(words.m.lineFailed({ noun: nounOf(slot), from: undefined, to: undefined }));
        return { message, retry: () => retry(slot), area };
    }, [data.error, data.failures, data.failedAreas, words, nounOf, retry]);
    // ── The footer's loading line (#1398, CL3): a read that failed first — the drawing's, a kind's, then a narrowing's the
    // frame follows — then what is read, then a narrowing resolving ──
    // A kind's source the frame follows whose narrowing resolves, its last standing in: `Filtering racks…`.
    const resolving = [...sourced].find((slot) => { const one = followed.get(slot); return one !== undefined && one.shown.busy && one.error === undefined; });
    const reading = data.reading;
    const line = useMemo((): LoadingLineValue | undefined => {
        const m = words.m;
        const failed = (text: LoadingLineText, reason: string, again: () => void): LoadingLineValue =>
            ({ kind: "failed", text, short: m.lineShort({ kind: "failed" }), reason, onRetry: again, retry: m.retry() });
        const loading = (text: LoadingLineText, filtering: boolean): LoadingLineValue =>
            ({ kind: "loading", text, short: m.lineShort({ kind: filtering ? "filtering" : "loading" }) });
        if (data.error !== undefined) return failed(m.lineFailed({ noun: m.drawingNoun(), from: undefined, to: undefined }), data.error, () => retry(undefined));
        const [failure] = data.failures;
        if (failure !== undefined) {
            const [slot, reason] = failure;
            const noun = nounOf(slot);
            return failed(data.failedAreas.has(slot) ? m.lineFailedInView({ noun }) : m.lineFailed({ noun, from: undefined, to: undefined }), reason, () => retry(slot));
        }
        // A source the frame follows whose narrowing could not be read: in its own noun, its Retry its own.
        const unread = [...followed.values()].find((source) => source.error !== undefined);
        if (unread?.error !== undefined) return failed(m.lineFailed({ noun: unread.name, from: undefined, to: undefined }), unread.error, unread.retry);
        if (reading !== undefined) {
            const noun = nounOf(reading.slot);
            if (reading.filtering) return loading(m.lineFiltering({ noun }), true);
            switch (reading.what) {
                case "area": return loading(m.lineInView({ noun }), false);
                case "counts": return loading(m.lineCounts(), false);
                case "details": {
                    const n = reading.waiting;
                    return loading(m.lineDetails({ n, count: words.number(n), noun: nounOf(reading.slot, n !== 1) }), false);
                }
                case "rows": return loading(m.lineLoading({ noun, from: undefined, to: undefined }), false);
            }
        }
        return resolving === undefined ? undefined : loading(m.lineFiltering({ noun: nounOf(resolving) }), true);
    }, [data.error, data.failures, data.failedAreas, followed, reading, resolving, nounOf, words, retry]);
    // Each source the library follows whose narrowing could not be read, with Retry (#1389).
    const followedFailures = [...followed.values()].filter((source) => source.error !== undefined);
    // Each record's session's banners, titled by its kind, an issue placed by the item it names.
    const labels = useMemo(() => new Map(drawing.items.map((item) => [item.key, item.label] as const)), [drawing.items]);
    const sessionName = (key: string) => {
        const slot = recordSlot(key);
        const name = kindName.get(slot) ?? slot;
        return stringEqual(slot, key) ? name : words.m.detailsName({ name });
    };
    const banners = sessions.length === 0 && followedFailures.length === 0 ? undefined : (
        <>
            {sessions.map((part) => (
                <SessionBanners key={part.key} session={part.session} words={editingWords} name={sessionName(part.kind)}
                    where={(issue) => labels.get(entityId({ kind: recordSlot(part.kind), key: issue.entry })) ?? issue.entry}
                    onAction={(action) => history.actOn(part.key, action)} />
            ))}
            {followedFailures.map((source) => (
                <Box key={source.name} data-schematic-banner="source">
                    <BannerView status="error" title={words.m.sourceUnavailable({ name: source.name })} description={source.error}
                        actions={<Button size="xs" variant="outline" onClick={source.retry}>{words.m.retry()}</Button>} />
                </Box>
            ))}
        </>
    );

    // ── The inspector (#1391, §9): the end pane, given `inspector` ──────
    // What Details shows: the selection as the drawing draws it, a net's leg with it; and its rows, read on their own.
    const entities = useMemo(() => drawnEntities(drawing), [drawing]);
    const inspectedNow = useMemo(() => inspectedOf(selection, leg, entities), [selection, leg, entities]);
    const inspected = useDataStable(inspectedNow, inspectedEqual);
    const inspectedRef = inspected.view === "entity" || inspected.view === "leg" ? inspected.ref : undefined;
    const [inspectedRows, setInspectedRows] = useState<SchematicInspectedRows>(NO_INSPECTED_ROWS);
    // Its rows in flight: what the frame's reveal waits on too, so its placeholders show by the same clock (#1398, CL4).
    const inspectorReading = inspectedRows.ref !== undefined && (inspectedRows.row.state === "reading" || inspectedRows.details?.state === "reading");
    // Its open tab, kept per viewer; Enter, or a double-click on an entity, opens Details — the pane too, collapsed.
    const { state: inspectorTab, setState: setInspectorTab } = usePersistedState<{ tab: string }>(`${keys.frame}.inspector.tab`, { tab: "details" });
    const onInspectorTab = useCallback((tab: string) => setInspectorTab({ tab }), [setInspectorTab]);
    const frameRef = useRef<HTMLDivElement>(null);
    const inspectorName = words.m.inspectorPane();
    const openDetails = useCallback(() => {
        setInspectorTab({ tab: "details" });
        frameRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${inspectorName}"]`)?.click();
    }, [setInspectorTab, inspectorName]);
    // What Details and Issues name, selected through the canvas — and flown to.
    const revealEntity = useCallback((id: string | undefined, at?: NetLeg) => canvasRef.current?.reveal(id, at), []);
    const zoneAt = useCallback((x: number, y: number) => zoneHolding(hosts, x, y)?.label, [hosts]);
    // The issues: each record's session's first — they block — then the drawing's. Whether an item is held is known for
    // an item kind read whole: its drawn rows and its backlog, the drafts in place.
    const itemSlots = useMemo(() => new Set(value.items.map((kind) => kind.key)), [value.items]);
    const wholeItems = useMemo(() => new Set(value.items.filter((kind) => kind.entries.type === "none").map((kind) => kind.key)), [value.items]);
    const heldItems = useMemo(() => new Set([...drawing.items.map((item) => item.key), ...backlog.map((entry) => entry.id)]), [drawing.items, backlog]);
    const historyVersion = editing.version;
    const issues = useMemo(() => [
        ...sessionIssues(sessions, kindName, (id) => labels.get(id)),
        ...drawingIssues({
            drawn: drawing, extent: value.extent, names: kindName, layers: layerValues, colours: THEME_COLOURS,
            holds: (ref) => (!itemSlots.has(ref.kind) ? false : wholeItems.has(ref.kind) ? heldItems.has(entityId(ref)) : undefined),
        }),
        // A session's readiness and its Save's issues move with the history's version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [sessions, historyVersion, kindName, labels, drawing, value.extent, layerValues, itemSlots, wholeItems, heldItems]);
    const end = schematicInspectorPane({
        value, inspected, rows: inspectedRows, drawn: drawing, listed, editing, counts, records, issues, zoneAt, reveal: revealEntity, refuse: setRefusal,
        tab: inspectorTab.tab, onTab: onInspectorTab, storageKey: keys.frame, words,
    });

    return (
        <Box css={styles.root} data-schematic="">
            {value.inspector && <SchematicInspectedReader value={value} inspected={inspectedRef} areas={areas} windows={data.windows} onRows={setInspectedRows} />}
            {backlogPages !== undefined && <SchematicBacklogCountReader source={backlogPages} parts={backlogPartKeys} onCount={setBacklogCount} />}
            {/* The frame's one reveal clock (CL4): the footer's line, the canvas's wash and placeholders and the inspector's show a
                read in flight after 150 ms, held 300 ms once shown. */}
            <LoadingReveal waiting={line?.kind === "loading" || inspectorReading}>
                <BuilderFrame
                    ref={frameRef}
                    storageKey={keys.frame}
                    label={words.m.frameLabel()}
                    loading={!data.ready && data.error === undefined}
                    busy={data.loading || narrowingBusy}
                    toolbar={items}
                    toolbarRef={toolbarRef}
                    banners={banners}
                    start={library}
                    end={end}
                    footer={<SchematicFooter styles={styles} words={words} density={data.density} names={kindName} viewport={viewport} extent={value.extent}
                        refusal={refusal} notices={notices} found={found} line={line} />}
                    liveFooter
                    onKeyDown={onKeyDown}
                >
                    <SchematicCanvas ref={canvasRef} value={value} data={drawing} layers={layers} narrowing={canvasNarrowing} tool={held.tool} linkKind={held.link}
                        words={words} editing={canvasEditing} onRefused={setRefusal} onSelection={onSelection} onOpen={value.inspector ? openDetails : undefined}
                        onZoneInView={listsIndex ? setInView : undefined} drop={drop.canvas} connectValues={connectValues}
                        viewport={areas.size > 0 ? viewport : undefined} density={data.density} overview={data.overview} reading={areas.size > 0 && data.loading}
                        unread={data.unread} failure={canvasFailure} onZoomRange={setZoomRange} />
                </BuilderFrame>
            </LoadingReveal>
        </Box>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Schematic extension on module load.
// =============================================================================

implementUIComponent(Schematic.Component, EastChakraSchematic);

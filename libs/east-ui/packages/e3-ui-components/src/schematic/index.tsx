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
 *   Fit, Find over the items, and the steps through them while something is
 *   selected. The tool held and the link kind Connect draws are the viewer's,
 *   kept under the Schematic's `id` (`tools.ts`). ⌘F, or Ctrl+F, anywhere in
 *   the frame focuses Find;
 * - **main** — the canvas (`canvas/view.tsx`), filling main, the minimap and
 *   the scale bar on it and no control of its own; the toolbar drives its
 *   camera and its steps through its handle;
 * - **the footer** — the counts (`counts.ts`), each record's last save, the
 *   changes waiting on Save, each Save's notice and why a gesture was refused
 *   (`footer.tsx`);
 * - **the banners** — a kind whose read failed, each with Retry: a kind read
 *   through its source of the slice asks the source again, and one read whole
 *   is read again; and each record's session's (`SessionBanners`), titled by
 *   its kind;
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
 * - **the skeleton** — `BuilderFrame.loading` covers the frame until every
 *   kind has been read once (or its read failed); later reads keep the canvas
 *   and what it draws until they land (§6.5, §10.4).
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
import { Schematic, schematicKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, focusKeySearch, getSomeorUndefined, historyShortcut, historyToolbarItem,
    implementUIComponent, typedInto, useDataStable, useFormatters, usePersistedState, useSlicesReactivity, type EditIssue, type EditingWords, type HistoryAction,
} from "@elaraai/east-ui-components";
import { schematicColorTokens } from "@elaraai/east-ui-components/internal";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { sourcePart, type KeyVisibilityWords } from "../shared/schedule/visibility.js";
import { backlogEntries } from "./backlog.js";
import { SchematicCanvas, type SchematicCanvasEditing, type SchematicCanvasHandle } from "./canvas/view.js";
import { entityId, refOfId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicRef } from "./canvas/drawn.js";
import { layerState } from "./canvas/layers.js";
import { hostZones, zoneHolding } from "./canvas/model.js";
import { INITIAL_SCHEMATIC_DATA, SchematicDataReader, type SchematicData, type SchematicValue } from "./data.js";
import { schematicCounts } from "./counts.js";
import { draftedDrawing, type DraftedCache } from "./drafted.js";
import type { SchematicDropContext, SchematicDropKind } from "./drop.js";
import type { NetLeg, SchematicEdit } from "./edits.js";
import { recordSlot, useSchematicEditing } from "./editing.js";
import { useFindItem, type FindableItem } from "./find.js";
import { SchematicFooter, savedRecords, type SchematicNotice } from "./footer.js";
import { drawnEntities, inspectedEqual, inspectedOf } from "./inspect.js";
import { schematicInspectorPane } from "./inspector.js";
import { NO_INSPECTED_ROWS, SchematicInspectedReader, type SchematicInspectedRows } from "./inspector-rows.js";
import { drawingIssues, sessionIssues } from "./issues.js";
import { layersInForce, useSchematicLayerView } from "./layers-view.js";
import { useSchematicLibrary, type SchematicBacklogNarrowing } from "./library.js";
import { schematicMessages, type SchematicWords } from "./messages.js";
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
    return (
        <>
            <SchematicDataReader value={value} attempt={attempt} onData={setData} />
            <SchematicFollows value={value} data={data} readAgain={readAgain} storageKey={storageKey} />
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
}

/**
 * The sources of the rail the library's tabs follow (#1389): each kind's
 * templates record's, and each an author's tab names — each once, in order —
 * and what the rail counts each in: a kind's templates, an author's tab's name.
 *
 * @param value - The payload
 * @param words - The Schematic's words
 * @returns The sources, and their nouns, by name
 */
function followedSources(value: SchematicValue, words: SchematicWords): { sources: string[]; nouns: Map<string, string> } {
    const nouns = new Map<string, string>();
    for (const kind of [...value.items, ...value.links, ...value.nets]) {
        const source = getSomeorUndefined(kind.templatesSource);
        if (source !== undefined && !nouns.has(source)) nouns.set(source, words.m.templatesNoun({ name: kind.name.toLocaleLowerCase(words.locale) }));
    }
    for (const tab of value.library) {
        const source = tab.type === "tab" ? getSomeorUndefined(tab.value.source) : undefined;
        if (tab.type === "tab" && source !== undefined && !nouns.has(source)) nouns.set(source, tab.value.name.toLocaleLowerCase(words.locale));
    }
    return { sources: [...nouns.keys()], nouns };
}

/**
 * The frame, once each source its library's tabs follow is read (#1389): what
 * each templates list and each author's tab shows of the source it names —
 * one component a source, so a payload naming another set keeps each one's
 * hooks in order.
 */
function SchematicFollows(props: SchematicFrameProps) {
    const { value } = props;
    const formatters = useFormatters();
    const words = useMemo((): SchematicWords => ({ ...formatters, m: schematicMessages }), [formatters]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const { sources, nouns } = useMemo(() => followedSources(value, words), [value, words]);
    // What a source's failed narrowing says, in the Schematic's words.
    const said = useCallback((name: string): KeyVisibilityWords => ({ changed: words.m.sourceChanged({ name }), failed: words.m.sourceFailed({ name }) }), [words]);
    return (
        <FollowSources chrome={chrome} narrowed={value.shown} sources={sources} nouns={nouns} said={said}>
            {(followed) => <SchematicFrame {...props} followed={followed} />}
        </FollowSources>
    );
}

/** No entity selected. */
const NOTHING_SELECTED: ReadonlySet<string> = new Set();

/** No card of the library selected. */
const NO_PICKS: ReadonlyMap<string, string> = new Map();

/** The theme colour tokens a colour may name (D14): what the Issues tab holds each colour to (#1391). */
const THEME_COLOURS: ReadonlySet<string> = new Set(schematicColorTokens);

/** The frame, its regions holding the Schematic's parts over one shared state — see the module docs. */
function SchematicFrame({ value, data, readAgain, storageKey, followed }: SchematicFrameProps & { readonly followed: FollowedSources }) {
    const styles = useSlotRecipe({ key: "schematic" })() as Styles;
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
    const editing = useSchematicEditing(value, `${storageKey}.${id ?? "schematic"}`, recordSlices, data.held);
    const editingWords = useMemo((): EditingWords => ({ ...formatters, m: editingMessages }), [formatters]);
    // What the canvas draws: the stored rows, the drafts in place, each drafted row drawn once.
    const draftedCache = useRef<DraftedCache>(new WeakMap());
    const drawing = useMemo(() => draftedDrawing(data.drawn, data.held, editing.drafts, draftedCache.current), [data.drawn, data.held, editing.drafts]);
    const canvasEditing = useMemo((): SchematicCanvasEditing | undefined => (editing.edits ? { record: editing.record, mint: editing.mint } : undefined),
        [editing.edits, editing.record, editing.mint]);
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
    const onSelection = useCallback((ids: ReadonlySet<string>, next: NetLeg | null) => {
        setSelection(ids);
        setLeg(next);
    }, []);
    const selected = selection.size > 0;
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

    // ── Find (§6.1): the items the drawing shows, by their keys ─────────
    const kindsBySlot = useMemo(() => new Map(value.items.map((kind, order) => [kind.key, { name: kind.name, order }] as const)), [value.items]);
    const findable = useMemo((): FindableItem[] => drawing.items.flatMap((item) => {
        const kind = kindsBySlot.get(item.ref.kind);
        return layers.hidden.has(item.key) || kind === undefined ? []
            : [{ id: item.key, key: item.ref.key, label: item.label, kind: kind.name, order: kind.order }];
    }), [drawing.items, layers.hidden, kindsBySlot]);
    const reveal = useCallback((entity: string) => canvasRef.current?.reveal(entity), []);
    const find = useFindItem(findable, words.m.findNoMatches(), reveal);

    // ── The toolbar (§6.1) ──────────────────────────────────────────────
    // What the rail counts a templates list's source in: its kind's templates.
    const nouns = useMemo(() => {
        const named: Record<string, string> = {};
        for (const kind of [...value.items, ...value.links, ...value.nets]) {
            const source = getSomeorUndefined(kind.templatesSource);
            if (source !== undefined && named[source] === undefined) named[source] = words.m.templatesNoun({ name: kind.name.toLocaleLowerCase(words.locale) });
        }
        return named;
    }, [value.items, value.links, value.nets, words]);
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
        onZoom: zoomBy, onFit: fit, selected, onStep: step, history: historyItem,
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
    // Every item kind's rows with no position, the drafts in place: the Backlog's.
    const backlog = useMemo(() => backlogEntries(value.items, data.unplaced, data.held, editing.drafts.items),
        [value.items, data.unplaced, data.held, editing.drafts.items]);
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
    // The Index's zones and items: what the canvas draws, a hidden layer's left out.
    const shownZones = useMemo(() => (layers.hidden.size === 0 ? drawing.zones : drawing.zones.filter((zone) => !layers.hidden.has(zone.key))), [drawing.zones, layers.hidden]);
    const shownItems = useMemo(() => (layers.hidden.size === 0 ? drawing.items : drawing.items.filter((item) => !layers.hidden.has(item.key))), [drawing.items, layers.hidden]);
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
        value, backlog, keys, context: dropContext, record: recordDrop, mint: editing.mint, selection: selectedRefs, centre: viewCentre,
        select: selectDropped, notice: setRefusal, words, unit: getSomeorUndefined(value.scaleUnit),
    });

    const library = useSchematicLibrary({
        value, zones: shownZones, items: shownItems, backlog, backlogNarrowing, layers: layerValues, layerCounts, layerView, onLayerView: setLayerView,
        inView, selected: selection, onReveal: reveal, keys, words, followed, picked, onPick, enter: drop.enter,
    });

    // ── The footer (§6.3) ───────────────────────────────────────────────
    const counted = useMemo(() => ({
        items: value.items.map((kind) => ({ key: kind.key, name: kind.name })),
        zones: value.zones.length > 0, links: value.links.length > 0, nets: value.nets.length > 0,
    }), [value.items, value.zones, value.links, value.nets]);
    const counts = useMemo(() => schematicCounts(counted, drawing, layers), [counted, drawing, layers]);
    // Each item kind read through its source of the slice: its record's total is its rows.
    const sources = useMemo(() => new Map(value.items.flatMap((kind) => {
        const part = sourcePart(chrome, kind.key);
        return part === undefined ? [] : [[kind.key, part] as const];
    })), [value.items, chrome]);
    const records = useMemo(() => savedRecords(value), [value]);
    // Each kind read through its source that writes: a Save's notice counts the rows it took out of the source's narrowing.
    const notices = useMemo((): SchematicNotice[] => [...value.items, ...value.zones, ...value.links, ...value.nets].flatMap((kind) => {
        const part = kind.editable && !value.readOnly ? sourcePart(chrome, kind.key) : undefined;
        const name = kind.name.toLocaleLowerCase(words.locale);
        return part === undefined ? [] : [{ slot: kind.key, slice: part, singular: words.m.kindNoun({ name, plural: false }), plural: words.m.kindNoun({ name, plural: true }) }];
    }), [value.items, value.zones, value.links, value.nets, value.readOnly, chrome, words]);
    const pending = edits ? history.pending : undefined;

    // ── The banners (§6.4, SC32): a kind whose read failed, with Retry ──
    const kindName = useMemo(() => new Map([...value.items, ...value.zones, ...value.links, ...value.nets].map((kind) => [kind.key, kind.name] as const)),
        [value.items, value.zones, value.links, value.nets]);
    // A kind read through its source asks its source again; one read whole is read again.
    const retry = useCallback((slot: string | undefined) => {
        const part = slot === undefined ? undefined : sourcePart(chrome, slot);
        if (part !== undefined) part.retry();
        else readAgain();
    }, [chrome, readAgain]);
    const failures = [...data.failures];
    // Each source the library follows whose narrowing could not be read, with Retry (#1389).
    const followedFailures = [...followed.values()].filter((source) => source.error !== undefined);
    // Each record's session's banners, titled by its kind, an issue placed by the item it names.
    const labels = useMemo(() => new Map(drawing.items.map((item) => [item.key, item.label] as const)), [drawing.items]);
    const sessionName = (key: string) => {
        const slot = recordSlot(key);
        const name = kindName.get(slot) ?? slot;
        return stringEqual(slot, key) ? name : words.m.detailsName({ name });
    };
    const banners = failures.length === 0 && data.error === undefined && sessions.length === 0 && followedFailures.length === 0 ? undefined : (
        <>
            {sessions.map((part) => (
                <SessionBanners key={part.key} session={part.session} words={editingWords} name={sessionName(part.kind)}
                    where={(issue) => labels.get(entityId({ kind: recordSlot(part.kind), key: issue.entry })) ?? issue.entry}
                    onAction={(action) => history.actOn(part.key, action)} />
            ))}
            {failures.map(([slot, message]) => (
                <Box key={slot} data-schematic-banner={slot}>
                    <BannerView status="error" title={words.m.kindUnavailable({ name: kindName.get(slot) ?? slot })} description={message}
                        actions={<Button size="xs" variant="outline" onClick={() => retry(slot)}>{words.m.retry()}</Button>} />
                </Box>
            ))}
            {followedFailures.map((source) => (
                <Box key={source.name} data-schematic-banner="source">
                    <BannerView status="error" title={words.m.sourceUnavailable({ name: source.name })} description={source.error}
                        actions={<Button size="xs" variant="outline" onClick={source.retry}>{words.m.retry()}</Button>} />
                </Box>
            ))}
            {data.error !== undefined && (
                <Box data-schematic-banner="">
                    <BannerView status="error" title={words.m.drawingUnavailable()} description={data.error}
                        actions={<Button size="xs" variant="outline" onClick={() => retry(undefined)}>{words.m.retry()}</Button>} />
                </Box>
            )}
        </>
    );

    // ── The inspector (#1391, §9): the end pane, given `inspector` ──────
    // What Details shows: the selection as the drawing draws it, a net's leg with it; and its rows, read on their own.
    const entities = useMemo(() => drawnEntities(drawing), [drawing]);
    const inspectedNow = useMemo(() => inspectedOf(selection, leg, entities), [selection, leg, entities]);
    const inspected = useDataStable(inspectedNow, inspectedEqual);
    const inspectedRef = inspected.view === "entity" || inspected.view === "leg" ? inspected.ref : undefined;
    const [inspectedRows, setInspectedRows] = useState<SchematicInspectedRows>(NO_INSPECTED_ROWS);
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
        value, inspected, rows: inspectedRows, drawn: drawing, editing, counts, records, issues, zoneAt, reveal: revealEntity, refuse: setRefusal,
        tab: inspectorTab.tab, onTab: onInspectorTab, storageKey: keys.frame, words,
    });

    return (
        <Box css={styles.root} data-schematic="" {...(data.loading ? { "aria-busy": "true" } : {})}>
            {value.inspector && <SchematicInspectedReader value={value} inspected={inspectedRef} onRows={setInspectedRows} />}
            <BuilderFrame
                ref={frameRef}
                storageKey={keys.frame}
                label={words.m.frameLabel()}
                loading={!data.ready && data.error === undefined}
                toolbar={items}
                toolbarRef={toolbarRef}
                banners={banners}
                start={library}
                end={end}
                footer={<SchematicFooter styles={styles} words={words} counts={counts} rows={data.rows} sources={sources} records={records}
                    pending={pending} notices={notices} refusal={refusal} />}
                onKeyDown={onKeyDown}
            >
                <SchematicCanvas ref={canvasRef} value={value} data={drawing} layers={layers} tool={held.tool} linkKind={held.link}
                    words={words} editing={canvasEditing} onRefused={setRefusal} onSelection={onSelection} onOpen={value.inspector ? openDetails : undefined}
                    onZoneInView={listsIndex ? setInView : undefined} drop={drop.canvas} connectValues={connectValues} />
            </BuilderFrame>
        </Box>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Schematic extension on module load.
// =============================================================================

implementUIComponent(Schematic.Component, EastChakraSchematic);

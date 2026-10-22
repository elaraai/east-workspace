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
 * - **the footer** — the counts (`counts.ts`) and each record's last save
 *   (`footer.tsx`);
 * - **the banners** — a kind whose read failed, each with Retry: a kind read
 *   through its source of the slice asks the source again, and one read whole
 *   is read again;
 * - **the skeleton** — `BuilderFrame.loading` covers the frame until every
 *   kind has been read once (or its read failed); later reads keep the canvas
 *   and what it draws until they land (§6.5, §10.4).
 *
 * The layers hide, lock and dim the entities on them as their author defaults
 * say (`canvas/layers.ts`). The host hears the whole selection through
 * `onSelect`, and vets a connection through `canConnect` (#1401, D34). The
 * Schematic fills the box it is given and draws no border: a host gives it a
 * box of its own height.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { ArrayType, equalFor, equivalentFor } from "@elaraai/east";
import { Schematic, schematicKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, focusKeySearch, getSomeorUndefined, implementUIComponent, useDataStable, useFormatters,
} from "@elaraai/east-ui-components";
import { sourcePart } from "../shared/schedule/visibility.js";
import { SchematicCanvas, type SchematicCanvasHandle } from "./canvas/view.js";
import type { DrawnItem, DrawnLink, DrawnNet, DrawnZone } from "./canvas/drawn.js";
import { layerState } from "./canvas/layers.js";
import { INITIAL_SCHEMATIC_DATA, SchematicDataReader, type SchematicData, type SchematicValue } from "./data.js";
import { schematicCounts } from "./counts.js";
import { useFindItem, type FindableItem } from "./find.js";
import { SchematicFooter, savedRecords } from "./footer.js";
import { schematicMessages, type SchematicWords } from "./messages.js";
import { useSchematicToolbarItems } from "./toolbar.js";
import { offeredTools, toolsInForce, useSchematicTools } from "./tools.js";

type Styles = Record<string, SystemStyleObject>;

// The memo compares closures too (#809): a payload whose functions captured new
// data is a new payload, which the reader reads again; what it draws keeps its
// identity while nothing it shows moves, so an in-progress edit or the camera
// is never replaced by a closure-only change.
const schematicEqual = equivalentFor(Schematic.Types.Payload);
const layersEqual = equalFor(ArrayType(Schematic.Types.Layer));

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
    /** The structural storage key: the frame keeps its panes under the Schematic's `id` (`schematicKeys(id).frame`). */
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
export const EastChakraSchematic = memo(function EastChakraSchematic({ value }: EastChakraSchematicProps) {
    const [data, setData] = useState<SchematicData>(INITIAL_SCHEMATIC_DATA);
    // A Retry of a kind read whole reads every kind again: the read's attempt moves.
    const [attempt, setAttempt] = useState(0);
    const readAgain = useCallback(() => setAttempt((n) => n + 1), []);
    return (
        <>
            <SchematicDataReader value={value} attempt={attempt} onData={setData} />
            <SchematicFrame value={value} data={data} readAgain={readAgain} />
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
}

/** The frame, its regions holding the Schematic's parts over one shared state — see the module docs. */
function SchematicFrame({ value, data, readAgain }: SchematicFrameProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as Styles;
    // The counts and the dates, in the app's locale (#850), and the Schematic's words.
    const formatters = useFormatters();
    const words = useMemo((): SchematicWords => ({ ...formatters, m: schematicMessages }), [formatters]);
    // Keyed on the id's text: each payload decodes its Option afresh, and the keys must hold while the id does.
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => schematicKeys(id), [id]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);

    // ── The layers: what their author defaults hide, lock and dim ───────
    const layerValues = useDataStable(value.layers, layersEqual);
    const layers = useMemo(() => layerState(layerValues, data.drawn), [layerValues, data.drawn]);

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
    const [selected, setSelected] = useState(false);
    const zoomBy = useCallback((factor: number) => canvasRef.current?.zoomBy(factor), []);
    const fit = useCallback(() => canvasRef.current?.fit(), []);
    const step = useCallback((delta: 1 | -1) => canvasRef.current?.step(delta), []);

    // ── Find (§6.1): the items the drawing shows, by their keys ─────────
    const kindsBySlot = useMemo(() => new Map(value.items.map((kind, order) => [kind.key, { name: kind.name, order }] as const)), [value.items]);
    const findable = useMemo((): FindableItem[] => data.drawn.items.flatMap((item) => {
        const kind = kindsBySlot.get(item.ref.kind);
        return layers.hidden.has(item.key) || kind === undefined ? []
            : [{ id: item.key, key: item.ref.key, label: item.label, kind: kind.name, order: kind.order }];
    }), [data.drawn.items, layers.hidden, kindsBySlot]);
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
    const items = useSchematicToolbarItems({
        styles, words, chrome, nouns, tools, held, links: linkChoices, onTools: pickTools, find,
        onZoom: zoomBy, onFit: fit, selected, onStep: step,
    });
    // ⌘F, or Ctrl+F, anywhere in the frame: Find, in whichever form the row holds it.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
        if (focusKeySearch(toolbarRef.current)) event.preventDefault();
    }, []);

    // ── The footer (§6.3) ───────────────────────────────────────────────
    const counted = useMemo(() => ({
        items: value.items.map((kind) => ({ key: kind.key, name: kind.name })),
        zones: value.zones.length > 0, links: value.links.length > 0, nets: value.nets.length > 0,
    }), [value.items, value.zones, value.links, value.nets]);
    const counts = useMemo(() => schematicCounts(counted, data.drawn, layers), [counted, data.drawn, layers]);
    // Each item kind read through its source of the slice: its record's total is its rows.
    const sources = useMemo(() => new Map(value.items.flatMap((kind) => {
        const part = sourcePart(chrome, kind.key);
        return part === undefined ? [] : [[kind.key, part] as const];
    })), [value.items, chrome]);
    const records = useMemo(() => savedRecords(value), [value]);

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
    const banners = failures.length === 0 && data.error === undefined ? undefined : (
        <>
            {failures.map(([slot, message]) => (
                <Box key={slot} data-schematic-banner={slot}>
                    <BannerView status="error" title={words.m.kindUnavailable({ name: kindName.get(slot) ?? slot })} description={message}
                        actions={<Button size="xs" variant="outline" onClick={() => retry(slot)}>{words.m.retry()}</Button>} />
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

    return (
        <Box css={styles.root} data-schematic="" {...(data.loading ? { "aria-busy": "true" } : {})}>
            <BuilderFrame
                storageKey={keys.frame}
                label={words.m.frameLabel()}
                loading={!data.ready && data.error === undefined}
                toolbar={items}
                toolbarRef={toolbarRef}
                banners={banners}
                footer={<SchematicFooter styles={styles} words={words} counts={counts} rows={data.rows} sources={sources} records={records} />}
                onKeyDown={onKeyDown}
            >
                <SchematicCanvas ref={canvasRef} value={value} data={data.drawn} layers={layers} tool={held.tool} linkKind={held.link}
                    words={words} onSelected={setSelected} />
            </BuilderFrame>
        </Box>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Schematic extension on module load.
// =============================================================================

implementUIComponent(Schematic.Component, EastChakraSchematic);

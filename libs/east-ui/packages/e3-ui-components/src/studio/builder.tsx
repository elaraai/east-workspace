/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioBuilder` — the renderer of the `StudioBuilder` extension
 * declared in `@elaraai/e3-ui` (#1000): the builder, built in the browser from
 * its interface — the pages record bound with its patch, the listed
 * components, the project, and the publish preview's words.
 *
 * - **The canvas** is the snap grid's editing canvas over the open page's
 *   placements: every gesture a draft of the page's editing session, Apply one
 *   patch through the record's patch write (`saveCells`). Its one toolbar
 *   holds the page's status, the canvas's own items, Save as template, Preview
 *   and Publish; its selection bar names the selected placement.
 * - **The palette** ({@link useStudioPalette}) is the pane before it, **the
 *   inspector** ({@link StudioInspector}) the body of the pane after it; the
 *   inspector's edits are requests the canvas takes as one gesture each. Both
 *   are pane descriptions the canvas's builder frame draws (#1125), `auto`:
 *   pinned beside the canvas on a desktop, over it on a narrow screen.
 * - **The publish preview** ({@link StudioPublishPreview}) takes the canvas's
 *   place while it shows. The canvas stays mounted, so its drafts stay its own,
 *   and it applies them when the preview asks before it publishes.
 *
 * What each part shows is e3-ui's East, compiled once ({@link studioEast}).
 * The page open in the builder is the UI store's, by the builder's id, which
 * the page library writes when it opens a page; the selection, the drafts
 * the canvas draws and the preview's state are the builder's own. The builder
 * fills its host and draws no border around itself.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button as ChakraButton, HStack as ChakraHStack, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import {
    ArrayType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing, EditingDraftFieldType, SnapGrid } from "@elaraai/east-ui/internal";
import {
    StudioBuilderComponent, StudioCellType, StudioComponentType, StudioEntryType, StudioKeyType, builderKeys,
} from "@elaraai/e3-ui/internal";
import {
    BannerView,
    EmptyStateView,
    SnapGridEditor,
    implementUIComponent,
    useFormatters,
    useTrackedEvaluation,
    type BuilderFrameDock,
    type SnapGridEditorCell,
    type SnapGridEditorEditing,
    type SnapGridEditorValue,
    type ToolbarItem,
} from "@elaraai/east-ui-components";

import { StudioInspector } from "./inspector.js";
import { useStudioMessages } from "./messages.js";
import { useOpenPage, type StudioKey } from "./open-page.js";
import { StudioLayout, StudioPlacement } from "./page.js";
import { useStudioPalette } from "./palette.js";
import { StudioPublishPreview } from "./publish.js";
import { StudioSaveTemplate } from "./save-template.js";
import { studioEast } from "./studio-east.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type StudioBuilderValue = ValueTypeOf<typeof StudioBuilderComponent.schema>;
/** A listed component. */
type Component = ValueTypeOf<typeof StudioComponentType>;
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** One entry of the pages record. */
type Entry = ValueTypeOf<typeof StudioEntryType>;
/** The canvas's selection, and a change asked of it. */
type UiState = ValueTypeOf<typeof SnapGrid.Types.UiState>;
/** An Apply asked of the canvas, and its answer. */
type ApplyState = ValueTypeOf<typeof SnapGrid.Types.ApplyState>;
/** A change the inspector asks of the canvas. */
type Request = ValueTypeOf<typeof SnapGrid.Types.Request>;

const CellsType = ArrayType(StudioCellType);
const encodeCells = encodeBeast2For(CellsType);
const decodeCells = decodeBeast2For(CellsType);
const encodeCell = encodeBeast2For(StudioCellType);
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(StudioCellType));
/** The canvas's entries — a page's placements — and their drafts, as its editing session types them. */
const CELL_TYPE = toEastTypeValue(StudioCellType);
const CELL_DRAFT_TYPE = toEastTypeValue(EditingDraftFieldType(StudioCellType));
const keyEqual = equalFor(StudioKeyType);
const printKey = printFor(StudioKeyType);
const NOTHING_SELECTED: UiState = { selected: none, request: none };

/** Props of {@link EastChakraStudioBuilder}. */
export interface EastChakraStudioBuilderProps {
    /** The payload, decoded. */
    value: StudioBuilderValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the builder — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The builder
 */
export const EastChakraStudioBuilder = memo(function EastChakraStudioBuilder({ value, storageKey }: EastChakraStudioBuilderProps) {
    const styles = useSlotRecipe({ key: "studioBuilder" })() as Styles;
    const statusRecipe = useSlotRecipe({ key: "status" });
    const m = useStudioMessages();
    const words = useFormatters();
    const east = studioEast();
    const { pages: handle, components, project } = value;
    const id = value.id.type === "some" ? value.id.value : undefined;
    const keys = useMemo(() => builderKeys(id), [id]);

    // The record, read where the builder renders, and again when it moves.
    const read = useCallback(() => handle.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    const pages = result.ok ? result.value : undefined;

    // The page open in the builder — the project's first until one is opened.
    const first = useMemo((): StudioKey => {
        if (pages !== undefined) {
            for (const [key, entry] of pages) {
                if (key.project === project && entry.type === "page") return key;
            }
        }
        return { project, page: "" };
    }, [pages, project]);
    const [open, writeOpen] = useOpenPage(keys.page, first);
    const openName = printKey(open);
    let entry: Entry | undefined;
    if (pages !== undefined) {
        for (const [key, found] of pages) {
            if (keyEqual(key, open)) {
                entry = found;
                break;
            }
        }
    }

    // The selection, the Apply the preview asks of the canvas, the placements
    // the canvas draws, and whether the preview shows — the builder's own.
    const [ui, setUi] = useState<UiState>(NOTHING_SELECTED);
    const [applying, setApplying] = useState<ApplyState>(variant("idle", null));
    const [drafted, setDrafted] = useState<{ page: string; cells: readonly Cell[] } | undefined>(undefined);
    const [previewing, setPreviewing] = useState(false);
    // A page opened from anywhere — the palette, the page library — opens with nothing selected.
    const shown = useRef(openName);
    useEffect(() => {
        if (shown.current === openName) return;
        shown.current = openName;
        setUi(NOTHING_SELECTED);
    }, [openName]);

    // The open page's placements as saved, as the canvas draws them (its
    // drafts in place), and as its live version holds them.
    const saved = useMemo((): readonly Cell[] => (entry === undefined ? [] : entry.type === "page" ? entry.value.draft.cells : entry.value.cells), [entry]);
    const cells = drafted !== undefined && drafted.page === openName ? drafted.cells : saved;
    const liveCells = useMemo(() => (entry !== undefined && entry.type === "page" && entry.value.live.type === "some"
        ? some(entry.value.live.value.page.cells) : none), [entry]);
    const title = entry === undefined ? "" : entry.type === "page" ? entry.value.draft.title : entry.value.title;

    // ── The canvas ────────────────────────────────────────────────────────
    const tiles = useMemo(() => east.canvasTiles(components), [east, components]);
    // Each tile's component, for the tile's content — kept as the canvas's
    // cells are drawn, so a dropped card's tile finds its component at once.
    const componentOf = useRef(new Map<string, string>());
    const cellView = useCallback((cell: Cell): SnapGridEditorCell => {
        componentOf.current.set(cell.key, cell.component);
        const tile = tiles.get(cell.component);
        return {
            key: cell.key,
            row: cell.row,
            span: cell.span,
            height: cell.height,
            minHeight: none,
            align: cell.align,
            // A frameless component renders bare; one the surface does not
            // list is its placeholder, in a tile.
            frame: tile === undefined ? true : tile.frame,
            label: cell.title.type === "some" ? cell.title : tile === undefined ? none : some(tile.name),
            icon: tile === undefined ? none : some(tile.icon),
            meta: tile === undefined ? some(cell.component) : some(tile.meta),
        };
    }, [tiles]);
    const snapshot = useMemo(() => encodeCells([...saved]), [saved]);
    const editing = useMemo((): SnapGridEditorEditing => ({
        sourceId: `studio.page:${openName}`,
        entryType: CELL_TYPE,
        idField: some("key"),
        draftType: CELL_DRAFT_TYPE,
        children: none,
        keyType: none,
        snapshot: some(snapshot),
        readEntry: (entryId: string) => {
            const cell = saved.find((c) => c.key === entryId);
            return cell === undefined ? none : some(encodeCell(cell));
        },
        onPatch: none,
        // Apply: the batch, one patch on the page through the record's patch write.
        onApply: some(variant("async", (bytes: Uint8Array) => east.save(handle, open, decodeBatch(bytes)))),
        mode: variant("batch", null),
        fields: { key: "key", row: "row", span: "span", height: some("height"), align: some("align") },
        derive: (bytes: Uint8Array) => decodeCells(bytes).map(cellView),
        // A component dropped from the palette: a placement at its span,
        // storing its fingerprint; the canvas fits the span to the row.
        create: some((card: { library: string; key: string }, at: { key: string; row: string }) => {
            const component = components.find((c) => c.key === card.key);
            if (component === undefined) throw new Error(`No component "${card.key}" is listed`);
            return encodeCell({
                key: at.key,
                row: at.row,
                span: component.span,
                height: none,
                align: variant("top", null),
                title: none,
                component: component.key,
                fingerprint: component.fingerprint,
            });
        }),
        ready: none,
        // The rows the canvas draws, for the palette's counts, the inspector and the preview.
        onDrafted: some((bytes: Uint8Array) => {
            setDrafted({ page: openName, cells: decodeCells(bytes) });
            return null;
        }),
    }), [openName, snapshot, saved, east, handle, open, cellView, components]);
    const uiBind = useMemo(() => ({
        read: () => ui,
        write: (next: UiState) => { setUi(next); return null; },
        has: () => true,
    }), [ui]);
    const applyBind = useMemo(() => ({
        read: () => applying,
        write: (next: ApplyState) => { setApplying(next); return null; },
        has: () => true,
    }), [applying]);
    const canvas = useMemo((): SnapGridEditorValue => ({
        cells: saved.map(cellView),
        variant: none,
        width: some("1440px"),
        height: some("fill"),
        maxHeight: none,
        zoom: none,
        guides: true,
        editing: some(editing),
        ui: some(uiBind),
        view: none,
        apply: some(applyBind),
        id: none,
        sources: [keys.components],
        canDrop: none,
        widths: [
            { label: m.device({ device: "desktop" }), icon: some("desktop"), width: "1440px" },
            { label: m.device({ device: "tablet" }), icon: some("tablet-screen-button"), width: "1024px" },
        ],
        toolbar: { start: [], end: [] },
        panes: { start: none, end: none },
        surface: some(variant("shell", null)),
    }), [saved, cellView, editing, uiBind, applyBind, keys.components, m]);

    // Each tile's content: its component's own UI, or its placeholder.
    const listedByKey = useMemo(() => {
        const byKey = new Map<string, Component[]>();
        for (const component of components) {
            const same = byKey.get(component.key);
            if (same === undefined) byKey.set(component.key, [component]);
            else same.push(component);
        }
        return byKey;
    }, [components]);
    const renderContent = useCallback((cell: SnapGridEditorCell) => {
        const component = componentOf.current.get(cell.key) ?? "";
        return <StudioPlacement component={component} listed={listedByKey.get(component) ?? []} storageKey={`${storageKey}.canvas.${cell.key}`} />;
    }, [listedByKey, storageKey]);

    // ── The toolbar: the page's status, Save as template, Preview and Publish ──
    const status = entry === undefined ? undefined
        : entry.type === "template" ? { label: m.statusTemplate(), tone: "neutral" as const, ring: false }
            : entry.value.live.type === "none" ? { label: m.statusDraft(), tone: "neutral" as const, ring: true }
                : east.changes(entry.value.live.value.page, entry.value.draft).length === 0
                    ? { label: m.statusLive(), tone: "success" as const, ring: false }
                    : { label: m.statusLiveEdited(), tone: "warning" as const, ring: false };
    const statusStyles = status === undefined ? undefined : statusRecipe({ status: status.tone, size: "md", ring: status.ring }) as Styles;
    const taken = useMemo(() => {
        const names = new Set<string>();
        if (pages !== undefined) {
            for (const [key] of pages) {
                if (key.project === open.project) names.add(key.page);
            }
        }
        return names;
    }, [pages, open.project]);
    const saveTemplate = useMemo(() => ({
        title,
        enabled: entry !== undefined && entry.type === "page",
        taken,
        // The open page, as last saved, as a template under a name — one commit.
        onSave: async (name: string) => {
            const now = handle.read();
            const patch = east.saveTemplate(now, open, { project: open.project, page: name }, name);
            const outcome = await handle.commit.patch("", patch);
            return east.nameWriteRefusal(outcome, name);
        },
    }), [title, entry, taken, handle, east, open]);
    const toolbar = {
        start: [status !== undefined && statusStyles !== undefined && {
            key: "status",
            side: "start",
            version: status.label,
            forms: [
                <ChakraHStack css={statusStyles.root} data-studio-status={status.tone}>
                    <Box as="span" css={statusStyles.indicator} />
                    <Box css={statusStyles.label}>{status.label}</Box>
                </ChakraHStack>,
            ],
        } satisfies ToolbarItem],
        end: [
            { key: "save-template", side: "end", forms: [<StudioSaveTemplate value={saveTemplate} />] } satisfies ToolbarItem,
            {
                key: "preview",
                side: "end",
                forms: [<ChakraButton variant="outline" data-studio-preview="" onClick={() => setPreviewing(true)}>{m.preview()}</ChakraButton>],
            } satisfies ToolbarItem,
            {
                key: "publish",
                side: "end",
                forms: [<ChakraButton variant="outline" data-studio-open-publish="" onClick={() => setPreviewing(true)}>{m.publish()}</ChakraButton>],
            } satisfies ToolbarItem,
        ],
    };

    // ── The palette, before the canvas ───────────────────────────────────
    const listed = useMemo(() => components.filter((c) => !c.deprecated), [components]);
    const cards = useMemo(() => east.paletteCards(listed, [...cells], ui.selected), [east, listed, cells, ui.selected]);
    const projectPages = useMemo(() => (pages === undefined ? [] : east.palettePages(pages, project)), [east, pages, project]);
    // A card's click selects its component's first placement on the page.
    const selectFirst = useCallback((component: string) => {
        const placement = cells.find((c) => c.component === component);
        if (placement !== undefined) setUi({ selected: some(placement.key), request: none });
    }, [cells]);
    // A page's click opens it, with nothing selected.
    const openPage = useCallback((page: string) => {
        writeOpen({ project, page });
        setUi(NOTHING_SELECTED);
    }, [writeOpen, project]);
    const paletteIds = useMemo(() => ({ components: keys.components, pages: keys.pages }), [keys.components, keys.pages]);
    const palette = useStudioPalette({
        components: listed, cards, pages: projectPages, open: open.project === project ? open.page : "", ids: paletteIds,
        onSelect: selectFirst, onOpen: openPage, storageKey,
    });

    // ── The inspector, after it ──────────────────────────────────────────
    const selection = useMemo(() => east.inspectorSelection(components, [...cells], liveCells, ui.selected),
        [east, components, cells, liveCells, ui.selected]);
    // A layout edit is a request on the selection: the canvas takes it as one gesture.
    const onRequest = useCallback((request: Request) => {
        setUi({ selected: some(request.key), request: some(request) });
        return null;
    }, []);
    const inspector = useMemo(() => ({ selection, onRequest }), [selection, onRequest]);
    const selected = selection.type === "some" ? selection.value : undefined;
    // One body, 300px wide; its rail names the selected placement, in the brand while there is one.
    const inspectorPane = useMemo((): BuilderFrameDock => ({
        label: m.inspector(),
        icon: "sliders",
        badge: selected === undefined ? "" : m.spanBadge({ span: words.number(Number(selected.layout.span)) }),
        active: selected !== undefined,
        detail: selected === undefined ? m.nothingSelected() : selected.name,
        size: "300px",
        body: <StudioInspector value={inspector} />,
    }), [m, words, selected, inspector]);

    // ── The publish preview, in the canvas's place ───────────────────────
    const summary = useMemo(() => (entry === undefined ? undefined
        : east.publishSummary(components, entry.type === "page" ? entry.value.live : none, { title, cells: [...cells] }, [...saved], entry.type === "template")),
    [east, components, entry, title, cells, saved]);
    const preview = useMemo(() => (summary === undefined ? undefined : {
        project: open.project,
        title,
        summary,
        env: value.env,
        audience: value.audience,
        rollout: value.rollout,
        apply: applying,
        // The canvas applies its drafts, and answers under the id.
        onApply: (ask: string) => { setApplying(variant("asked", ask)); return null; },
        // The publish, from the record as it stands when it commits — what an
        // Apply just before it left.
        onPublish: async () => {
            const now = handle.read();
            const patch = east.publish(now, open, components);
            const outcome = await handle.commit.patch("", patch);
            return east.publishRefusal(outcome);
        },
        onExit: some(() => { setPreviewing(false); return null; }),
    }), [summary, open, title, value.env, value.audience, value.rollout, applying, handle, east, components]);

    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={message} />;
    }
    if (entry === undefined) {
        return (
            <EmptyStateView icon={{ prefix: "fas", name: "file-circle-question" }}
                title={m.noPageOpen()} description={m.noPageOpenHint({ project, page: open.page })} />
        );
    }
    return (
        <Box css={styles.root} data-studio-builder="">
            <Box css={styles.canvas} hidden={previewing} data-studio-canvas="">
                <SnapGridEditor
                    value={canvas}
                    storageKey={`${storageKey}.canvas`}
                    toolbar={toolbar}
                    renderContent={renderContent}
                    panes={{ start: palette, end: inspectorPane }}
                />
            </Box>
            {previewing && preview !== undefined && (
                <StudioPublishPreview value={preview}
                    page={<StudioLayout cells={cells} components={components} storageKey={`${storageKey}.preview`} />} />
            )}
        </Box>
    );
});

implementUIComponent(StudioBuilderComponent, EastChakraStudioBuilder);

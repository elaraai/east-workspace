/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioBuilder` — the renderer of the `StudioBuilder` extension
 * declared in `@elaraai/e3-ui` (#1000): the builder, built in the browser from
 * its interface — the pages record bound with its patch, the listed
 * components and sources, the project, the page it shows and who to tell of
 * another, and the publish preview's words.
 *
 * - **The canvas** is the snap grid's editing canvas over the open page's
 *   placements: every gesture a draft of the page's editing session, Apply one
 *   patch through the record's patch write (`saveCells`). Its one toolbar
 *   holds the page's status, the canvas's own items, Save as template, Preview
 *   and Publish; its selection bar names the selected placement. A row short
 *   of room (#1229), once the canvas's own items have folded, folds Save as
 *   template, Preview and Publish into one ⋯ chip, whose menu holds the three
 *   — Save as template… opening its popover from the chip — then the status.
 * - **The palette** ({@link useStudioPalette}) is the pane before it: a
 *   visual dropped from it is placed at its kind's span, empty, over the
 *   source the page's visuals read most (#1672, BLD-2); a text block at the
 *   full width. **The inspector** is the pane after it, two tabs: Configure
 *   ({@link StudioConfigure}), what the selected placement holds, edited — the
 *   tab a visual or a text block opens on as it is selected, and the one the
 *   canvas's Edit and a visual's Edit visual open (EDT-1) — and Layout
 *   ({@link StudioInspector}). The inspector's edits are requests the canvas
 *   takes as one gesture each; a visual's menu's Duplicate is the canvas's
 *   copy. Both panes are pane descriptions the canvas's builder frame draws
 *   (#1125), `auto`: pinned beside the canvas on a desktop, over it on a
 *   narrow screen.
 * - **The publish preview** ({@link StudioPublishPreview}) takes the canvas's
 *   place while it shows. The canvas stays mounted, so its drafts stay its own,
 *   and it applies them when the preview asks before it publishes.
 *
 * What each part shows is e3-ui's East, compiled once ({@link studioEast}).
 * The page open in the builder is its host's when it gives one — the builder
 * shows it, and tells the host when its palette's Pages tab asks for another
 * — else the builder's own, kept under its storage key ({@link useOpen},
 * #1668); the selection, the drafts the canvas draws and the preview's state
 * are the builder's own. The builder fills its host and draws no border
 * around itself.
 *
 * In a phone's frame (`Studio Mobile Spec.md`) the canvas is its phone form, which
 * the snap grid draws by itself; the builder gives it the page's head, Add a
 * component and what a card or the inspector's Move starts placing. A tap on a
 * card or a page closes the pane's view; opening a pane ends placing. Its first
 * row is {@link StudioPhoneBar}. The preview's two tabs are what Preview and
 * Publish open.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button as ChakraButton, HStack as ChakraHStack, Menu as ChakraMenu, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import {
    ArrayType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing, EditingDraftFieldType, SnapGrid } from "@elaraai/east-ui/internal";
import {
    Studio, StudioBuilderComponent, StudioCellType, StudioContentType, StudioEntryType, StudioKeyType, builderKeys, studioEditors,
} from "@elaraai/e3-ui/internal";
import {
    BannerView,
    ChipMenu,
    EmptyStateView,
    NARROW_FRAME,
    SNAP_GRID_HOST_RANK,
    SnapGridEditor,
    implementUIComponent,
    useContainerWidth,
    useFormatters,
    useTrackedEvaluation,
    type BuilderFrameDock,
    type SnapGridEditorCell,
    type SnapGridEditorEditing,
    type SnapGridEditorValue,
    type SnapGridPlacing,
    type ToolbarItem,
} from "@elaraai/east-ui-components";

import { VisualAnswersProvider } from "../query/visual/answers.js";
import { openCodec, useOpen } from "../shared/open.js";
import { StudioConfigure } from "./configure.js";
import { StudioInspector } from "./inspector.js";
import { useStudioMessages } from "./messages.js";
import { StudioLayout, StudioPlacement, useListedByKey } from "./page.js";
import { sourcesRead, useStudioFilterItems } from "./filter-rail.js";
import { clickFields } from "../query/visual/links.js";
import { useLinking } from "./linking.js";
import { PageClicksProvider } from "./page-clicks.js";
import { PageFiltersProvider } from "./page-filters.js";
import { visualName } from "./visual/values.js";
import { useStudioPalette, visualCards, type PlacedCard } from "./palette.js";
import { StudioPhoneBar } from "./phone.js";
import { StudioPublishPreview } from "./publish.js";
import { StudioSaveTemplate } from "./save-template.js";
import { studioEast } from "./studio-east.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type StudioBuilderValue = ValueTypeOf<typeof StudioBuilderComponent.schema>;
/** A page's key. */
type StudioKey = ValueTypeOf<typeof StudioKeyType>;
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** What a placement holds. */
type Content = ValueTypeOf<typeof StudioContentType>;
/** A visual. */
type Visual = Extract<Content, { type: "visual" }>["value"];
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
const encodeContent = encodeBeast2For(StudioContentType);

/** A visual's content written whole: one gesture the canvas takes on its placement. */
function visualRequest(key: string, visual: Visual): Request {
    return { key, change: variant("field", { name: "content", value: encodeContent(variant("visual", visual)) }) };
}
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(StudioCellType));
/** The canvas's entries — a page's placements — and their drafts, as its editing session types them. */
const CELL_TYPE = toEastTypeValue(StudioCellType);
const CELL_DRAFT_TYPE = toEastTypeValue(EditingDraftFieldType(StudioCellType));
const keyEqual = equalFor(StudioKeyType);
const stringEqual = equalFor(StringType);
const printKey = printFor(StudioKeyType);
/** How the builder's own open page is kept, and one page told from another. */
const OPEN_PAGE = openCodec(StudioKeyType);
const NOTHING_SELECTED: UiState = { selected: none, request: none };

/**
 * The fold order of the builder's own toolbar items (#1229), after every step
 * of the canvas's own ({@link SNAP_GRID_HOST_RANK}) and before the history
 * item's: Save as template, Preview and Publish fold into the ⋯ chip in one
 * step, then the page's status goes.
 */
const RANK_MORE = SNAP_GRID_HOST_RANK;
const RANK_STATUS = SNAP_GRID_HOST_RANK + 10;
/** The fold of Save as template, Preview and Publish into the ⋯ chip: one bundle, applied together. */
const MORE_BUNDLE = "studio.more";

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
    const { pages: handle, components, sources, project } = value;
    const id = value.id.type === "some" ? value.id.value : undefined;
    // Each listed source's name, by its key: what a visual's source is called.
    const sourceNames = useMemo(() => east.sourceNames(sources), [east, sources]);
    // Each listed component's name, by its key: what a placement of it is called in words.
    const componentNames = useMemo(() => east.componentNames(components), [east, components]);
    const keys = useMemo(() => builderKeys(id), [id]);

    // The record, read where the builder renders, and again when it moves.
    const read = useCallback(() => handle.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    const pages = result.ok ? result.value : undefined;

    // The page open in the builder: its host's, else its own — the project's first until one is opened.
    const first = useMemo((): StudioKey => {
        if (pages !== undefined) {
            for (const [key, entry] of pages) {
                if (stringEqual(key.project, project) && entry.type === "page") return key;
            }
        }
        return { project, page: "" };
    }, [pages, project]);
    // The page it kept from before stands while the record holds it in this project.
    const stands = useCallback((kept: StudioKey) => pages !== undefined && stringEqual(kept.project, project) && pages.has(kept), [pages, project]);
    const [open, openAnother] = useOpen({
        codec: OPEN_PAGE, storageKey: `${storageKey}.page`, given: value.page, first, stands,
        onOpen: value.onOpen.type === "some" ? value.onOpen.value : undefined,
    });
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
    // A phone's frame: the builder's own width, its open preview tab, what is being placed, and its panes' views.
    const widthRef = useRef<HTMLDivElement | null>(null);
    const width = useContainerWidth(widthRef);
    const phone = width > 0 && width <= NARROW_FRAME;
    const [previewTab, setPreviewTab] = useState<"page" | "changes">("page");
    const [placing, setPlacing] = useState<SnapGridPlacing | undefined>(undefined);
    const [collapsed, setCollapsed] = useState({ start: false, end: false });
    // The inspector's open tab: Configure, what the placement holds, or Layout (#1672).
    const [inspectorTab, setInspectorTab] = useState<"configure" | "layout">("configure");
    // Save as template's popover, opened from the ⋯ chip's menu (#1229).
    const [naming, setNaming] = useState(false);
    // A page opened from anywhere — the palette, the host — opens with nothing selected, nothing being placed, and in a
    // phone's frame its palette's view closed. A page asked for moves nothing until it opens: a host that holds the page
    // may open it later, or not at all.
    const shown = useRef(openName);
    useEffect(() => {
        if (shown.current === openName) return;
        shown.current = openName;
        setUi(NOTHING_SELECTED);
        setPlacing(undefined);
        if (phone) setCollapsed((was) => (was.start ? was : { ...was, start: true }));
    }, [openName, phone]);

    // The open page's placements as saved, and as the canvas draws them (its
    // drafts in place).
    const saved = useMemo((): readonly Cell[] => (entry === undefined ? [] : entry.type === "page" ? entry.value.draft.cells : entry.value.cells), [entry]);
    const cells = drafted !== undefined && drafted.page === openName ? drafted.cells : saved;
    const title = entry === undefined ? "" : entry.type === "page" ? entry.value.draft.title : entry.value.title;
    // The placements the canvas draws, as a dropped visual reads them for its source.
    const cellsRef = useRef(cells);
    cellsRef.current = cells;
    // The palette's visuals: each kind's, while a source is listed for them to read, and the text block (BLD-1).
    const listedComponents = useMemo(() => components.filter((c) => !c.deprecated), [components]);
    const visuals = useMemo(() => visualCards(studioEditors, sources.length, listedComponents, m.textCard()), [sources.length, listedComponents, m]);

    // ── The canvas ────────────────────────────────────────────────────────
    const tiles = useMemo(() => east.canvasTiles(components), [east, components]);
    // The tile of what a placement holds: e3-ui's East — none for a component the surface does not list.
    const tileOf = useCallback((content: Content) => {
        const tile = east.contentTile(content, tiles, sourceNames);
        return tile.type === "some" ? tile.value : undefined;
    }, [east, tiles, sourceNames]);
    // The open page's placements, each named as its tile is: what the Configure tab's Follows block picks a leader from (#1673).
    const configurePlacements = useMemo(() => cells.map((cell) => {
        // A visual's name is its tile's eyebrow's: its own title, else one made from its wells (TIL-1).
        const visual = cell.content.type === "visual" ? cell.content.value : undefined;
        const source = visual === undefined ? undefined : sources.find((listed) => stringEqual(listed.key, visual.source));
        const made = visual === undefined || source === undefined ? undefined : visualName(visual.view, source, m);
        return {
            cell,
            name: cell.title.type === "some" ? cell.title.value : made ?? tileOf(cell.content)?.name ?? east.contentWords(cell.content, sourceNames, componentNames),
        };
    }), [cells, sources, tileOf, east, sourceNames, componentNames, m]);
    // Linking on the canvas (LNK-6, LNK-7): a link's edits are requests on its placements, one gesture each — the
    // leader's first, where linking switched its click, then the follower's, which stays selected.
    const asked = useRef<Request[]>([]);
    /** Asks the canvas for changes, a gesture each, in order: the first now, each next as the one before is taken. */
    const ask = useCallback((requests: readonly Request[]) => {
        const [first, ...rest] = requests;
        if (first === undefined) return;
        asked.current = rest;
        setUi({ selected: some(first.key), request: some(first) });
    }, []);
    const onLinked = useCallback((edits: readonly { readonly key: string; readonly visual: Visual }[]) => {
        ask(edits.map(({ key, visual }) => visualRequest(key, visual)));
    }, [ask]);
    const linking = useLinking({ placements: configurePlacements, sources, onLinked });
    // Add a linked visual (LNK-8): a new column chart in a new row after its leader's, on the leader's source, already
    // following it on the first field its clicks tell — the leader's click switched to select first, where it was not.
    const addLinked = useCallback((leaderKey: string) => {
        const cell = cells.find((held) => held.key === leaderKey);
        const leader = cell !== undefined && cell.content.type === "visual" ? cell.content.value : undefined;
        const from = leader === undefined ? undefined : clickFields(leader.view)[0];
        const chart = visuals.find((card) => card.kind !== undefined && stringEqual(card.kind.type, "column"));
        if (leader === undefined || from === undefined || chart === undefined || chart.kind === undefined) return;
        const content = Studio.visual.of(leader.source, east.emptyView(chart.kind), { follow: { leader: leaderKey, from, to: from, empty: variant("all", null) } });
        // Its key and its row are the canvas's to set: a fresh key from this one, in the new row.
        const entry = encodeCell({ key: "linked", row: "", span: chart.span, height: none, align: variant("top", null), title: none, content });
        ask([
            ...(leader.click.type === "select" ? [] : [visualRequest(leaderKey, { ...leader, click: variant("select", null) })]),
            { key: leaderKey, change: variant("add", entry) },
        ]);
    }, [cells, visuals, east, ask]);
    // Each tile's placement — kept as the canvas's cells are drawn, so a
    // dropped card's tile finds what it holds, and its title, at once.
    const placedOf = useRef(new Map<string, Cell>());
    const cellView = useCallback((cell: Cell): SnapGridEditorCell => {
        placedOf.current.set(cell.key, cell);
        const tile = tileOf(cell.content);
        return {
            key: cell.key,
            row: cell.row,
            span: cell.span,
            height: cell.height,
            minHeight: none,
            align: cell.align,
            // A frameless component and a text block render bare; a component
            // the surface does not list is its placeholder, in a tile.
            frame: tile === undefined ? true : tile.frame,
            label: cell.title.type === "some" ? cell.title : tile === undefined ? none : some(tile.name),
            icon: tile === undefined ? none : some(tile.icon),
            // What its code reads, never its key; a component the surface does not list is known by its key alone.
            meta: tile !== undefined ? (tile.meta.length === 0 ? none : some(tile.meta)) : cell.content.type === "component" ? some(cell.content.value) : none,
        };
    }, [tileOf]);
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
        // A page's Save is the builder's own, over one entry of the pages record: it has no draft form.
        toDraft: none,
        fields: { key: "key", row: "row", span: "span", height: some("height"), align: some("align") },
        derive: (bytes: Uint8Array) => decodeCells(bytes).map(cellView),
        // A card dropped from the palette: a component's placement at its span; a visual's at its kind's, empty, over the
        // source the page's visuals read most (BLD-2); a text block's at the full width. The canvas fits the span to the row.
        create: some((card: { library: string; key: string }, at: { key: string; row: string }) => {
            const placement = (span: bigint, content: Content) => encodeCell({
                key: at.key, row: at.row, span, height: none, align: variant("top", null), title: none, content,
            });
            const component = components.find((c) => c.key === card.key);
            if (component !== undefined) return placement(component.span, variant("component", component.key));
            const visual = visuals.find((v) => v.key === card.key);
            if (visual === undefined) throw new Error(`No component "${card.key}" is listed`);
            if (visual.kind === undefined) return placement(visual.span, Studio.visual.text(m.newText()));
            const source = east.mostUsedSource([...cellsRef.current], sources);
            if (source.type === "none") throw new Error("No source is listed for a visual to read");
            return placement(visual.span, Studio.visual.of(source.value, east.emptyView(visual.kind)));
        }),
        ready: none,
        // The rows the canvas draws, for the palette's counts, the inspector and the preview.
        onDrafted: some((bytes: Uint8Array) => {
            setDrafted({ page: openName, cells: decodeCells(bytes) });
            return null;
        }),
    }), [openName, snapshot, saved, east, handle, open, cellView, components, visuals, sources, m]);
    const uiBind = useMemo(() => ({
        read: () => ui,
        write: (next: UiState) => {
            // While a leader is picked, a tile's click is the pick's, never the canvas's selection — and neither Esc,
            // which leaves the mode, nor a click on the canvas itself lets the visual being linked go.
            if (linking.active && next.request.type === "none") {
                if (next.selected.type === "some") linking.pick(next.selected.value);
                return null;
            }
            // A gesture taken: the next a link asked for, if one waits.
            const waiting = next.request.type === "none" ? asked.current.shift() : undefined;
            setUi(waiting === undefined ? next : { selected: some(waiting.key), request: some(waiting) });
            return null;
        },
        has: () => true,
    }), [ui, linking]);
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
            // A phone's: the canvas lays the page out as a phone shows it, stacked.
            { label: m.device({ device: "mobile" }), icon: some("mobile-screen"), width: "390px" },
        ],
        toolbar: { start: [], end: [] },
        panes: { start: none, end: none },
        surface: some(variant("shell", null)),
    }), [saved, cellView, editing, uiBind, applyBind, keys.components, m]);

    // A placement opened for editing — the canvas's Edit, a visual's Edit visual: selected, its Configure tab shown (EDT-1).
    const editPlacement = useCallback((key: string) => {
        setUi({ selected: some(key), request: none });
        setInspectorTab("configure");
        setCollapsed((was) => (was.end ? { ...was, end: false } : was));
    }, []);
    // A visual's Duplicate: the canvas's copy of it, after it, selected.
    const duplicatePlacement = useCallback((key: string) => {
        setUi({ selected: some(key), request: some({ key, change: variant("duplicate", null) }) });
    }, []);

    // A visual's Link: it is selected, and the canvas picks the visual it should follow (LNK-6).
    const startLinking = linking.start;
    const linkPlacement = useCallback((key: string) => {
        setUi({ selected: some(key), request: none });
        startLinking(key);
    }, [startLinking]);

    // Each tile's content: what its placement holds — its component's own UI, its text, its visual — or its placeholder.
    const listedByKey = useListedByKey(components);
    const renderContent = useCallback((cell: SnapGridEditorCell) => {
        const placed = placedOf.current.get(cell.key);
        if (placed === undefined) return null;
        // A visual's tile is named by its placement's own title, else by its wells — as the page draws it — and its menu
        // edits and copies it.
        return (
            <StudioPlacement content={placed.content} listed={listedByKey} sources={sourceNames} storageKey={`${storageKey}.canvas.${cell.key}`}
                title={placed.title.type === "some" ? placed.title.value : undefined} placement={cell.key} pick={linking.stateOf(cell.key)}
                edit={{
                    onEdit: () => editPlacement(cell.key), onDuplicate: () => duplicatePlacement(cell.key), onLink: () => linkPlacement(cell.key),
                    // Only a visual whose clicks tell a field can be followed.
                    onAddLinked: placed.content.type === "visual" && clickFields(placed.content.value.view).length > 0 ? () => addLinked(cell.key) : undefined,
                }} />
        );
    }, [listedByKey, sourceNames, storageKey, editPlacement, duplicatePlacement, linkPlacement, addLinked, linking]);

    // ── The toolbar: the page's status, Save as template, Preview and Publish ──
    const status = entry === undefined ? undefined
        : entry.type === "template" ? { label: m.statusTemplate(), tone: "neutral" as const, ring: false }
            : entry.value.live.type === "none" ? { label: m.statusDraft(), tone: "neutral" as const, ring: true }
                : east.changes(entry.value.live.value.page, entry.value.draft, sourceNames, componentNames).length === 0
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
    // Folded, the three are one ⋯ chip: its menu holds them, and Save as
    // template… opens their popover from the chip, which holds its item open.
    const more = (
        <StudioSaveTemplate value={saveTemplate} open={naming} onOpenChange={setNaming} anchor={
            <ChipMenu label={m.more()} icon={faEllipsis} data="data-studio-more" onSelect={(picked) => {
                if (picked === "save-template") setNaming(true);
                else if (picked === "preview" || picked === "publish") setPreviewing(true);
            }}>
                <ChakraMenu.Item value="save-template" disabled={!saveTemplate.enabled}
                    {...(saveTemplate.enabled ? {} : { title: m.templateOpen() })}>{m.saveAsTemplateItem()}</ChakraMenu.Item>
                <ChakraMenu.Item value="preview">{m.preview()}</ChakraMenu.Item>
                <ChakraMenu.Item value="publish">{m.publish()}</ChakraMenu.Item>
            </ChipMenu>
        } />
    );
    // The reader's filters of the open page, among the toolbar's items as other builders place their rail.
    const filtered = useMemo(() => sourcesRead(cells), [cells]);
    const filterItems = useStudioFilterItems(open, sources, filtered);
    const toolbar = phone ? {
        // On a phone the page's filters are the rail's Filters button, which opens its view over the builder (#1673).
        end: [...filterItems, {
            key: "studio.phone", forms: [null], phone: {
                grow: true,
                form: <StudioPhoneBar status={status} saveTemplate={saveTemplate} project={open.project}
                    onPreview={() => { setPreviewTab("page"); setPreviewing(true); }} onPublish={() => { setPreviewTab("changes"); setPreviewing(true); }} />,
            },
        } satisfies ToolbarItem],
    } : {
        start: [status !== undefined && statusStyles !== undefined && {
            key: "status",
            side: "start",
            version: status.label,
            rank: RANK_STATUS,
            forms: [
                <ChakraHStack css={statusStyles.root} data-studio-status={status.tone}>
                    <Box as="span" css={statusStyles.indicator} />
                    <Box css={statusStyles.label}>{status.label}</Box>
                </ChakraHStack>,
                null,
            ],
        } satisfies ToolbarItem, ...filterItems],
        end: [
            {
                key: "save-template", side: "end", rank: RANK_MORE, bundle: MORE_BUNDLE,
                forms: [<StudioSaveTemplate value={saveTemplate} />, null],
            } satisfies ToolbarItem,
            // As tall as every control in the row (`sm`, 28px, ruled 23 Oct 2026).
            {
                key: "preview", side: "end", rank: RANK_MORE, bundle: MORE_BUNDLE,
                forms: [<ChakraButton variant="outline" size="sm" data-studio-preview="" onClick={() => setPreviewing(true)}>{m.preview()}</ChakraButton>, null],
            } satisfies ToolbarItem,
            {
                key: "publish", side: "end", rank: RANK_MORE, bundle: MORE_BUNDLE,
                forms: [<ChakraButton variant="outline" size="sm" data-studio-open-publish="" onClick={() => setPreviewing(true)}>{m.publish()}</ChakraButton>, null],
            } satisfies ToolbarItem,
            { key: "more", side: "end", rank: RANK_MORE, bundle: MORE_BUNDLE, held: naming, forms: [null, more] } satisfies ToolbarItem,
        ],
    };

    // ── The palette, before the canvas ───────────────────────────────────
    const listed = listedComponents;
    const cards = useMemo(() => east.paletteCards(listed, [...cells], phone ? none : ui.selected), [east, listed, cells, ui.selected, phone]);
    const projectPages = useMemo(() => (pages === undefined ? [] : east.palettePages(pages, project)), [east, pages, project]);
    // A card's click selects its component's first placement on the page.
    const selectFirst = useCallback((component: string) => {
        const placement = cells.find((c) => c.content.type === "component" && c.content.value === component);
        if (placement !== undefined) setUi({ selected: some(placement.key), request: none });
    }, [cells]);
    // A page's click asks for it: the builder's own opens, a host's is the host's to change. What follows a page opening —
    // nothing selected, the phone's view closed — follows once it has, above; the page already open has nothing to wait
    // for, so a phone's tap on it closes the view at once.
    const openPage = useCallback((page: string) => {
        if (keyEqual(open, { project, page })) {
            if (phone) setCollapsed((was) => (was.start ? was : { ...was, start: true }));
            return;
        }
        openAnother({ project, page });
    }, [openAnother, open, project, phone]);
    // A card's tap on a phone: the view closes and placing starts (ST22).
    const onPage = useMemo(() => new Set(cells.flatMap((c) => (c.content.type === "component" ? [c.content.value] : []))), [cells]);
    const palettePhone = useMemo(() => (!phone ? undefined : {
        onPage,
        onPlace: (card: PlacedCard) => {
            setUi(NOTHING_SELECTED);
            setPlacing({ kind: "add", card: { library: keys.components, key: card.key }, label: card.label, span: card.span });
            setCollapsed((was) => ({ ...was, start: true }));
        },
    }), [phone, onPage, keys.components]);
    const paletteIds = useMemo(() => ({ components: keys.components, pages: keys.pages }), [keys.components, keys.pages]);
    const palette = useStudioPalette({
        visuals, components: listed, cards, pages: projectPages, open: stringEqual(open.project, project) ? open.page : "", ids: paletteIds,
        onSelect: selectFirst, onOpen: openPage, storageKey, phone: palettePhone,
    });

    // ── The inspector, after it ──────────────────────────────────────────
    const selection = useMemo(() => east.inspectorSelection(components, sourceNames, [...cells], ui.selected),
        [east, components, sourceNames, cells, ui.selected]);
    // An edit — of the layout, or of what it holds — is a request on the selection: the canvas takes it as one gesture.
    const onRequest = useCallback((request: Request) => {
        setUi({ selected: some(request.key), request: some(request) });
        return null;
    }, []);
    const inspector = useMemo(() => ({ selection, sources, editors: [...studioEditors], onRequest }), [selection, sources, onRequest]);
    const selected = selection.type === "some" ? selection.value : undefined;
    // A visual or a text block selected anew opens the Configure tab (EDT-1); a component leaves the tab as it was.
    const shownSelection = useRef<string | undefined>(undefined);
    useEffect(() => {
        const key = selected?.key;
        if (key === shownSelection.current) return;
        shownSelection.current = key;
        if (selected !== undefined && selected.cell.content.type !== "component") setInspectorTab("configure");
    }, [selected]);
    // What the selected placement holds as the page is saved — what the Configure tab tints its changes against — and the
    // project's pages, which a click may open.
    const savedContent = useMemo(() => saved.find((c) => c.key === selected?.key)?.content, [saved, selected?.key]);
    const configurePages = useMemo(() => projectPages.map((page) => ({ key: { project, page: page.page }, title: page.title })), [projectPages, project]);
    // A visual's wells, and the Fields list they take fields from: their own drags, apart from the canvas's.
    const wellsDnd = useMemo(() => ({ wells: `${keys.components}.wells`, fields: `${keys.components}.fields` }), [keys.components]);
    // Where the selected placement stands, for a phone's inspector (ST24).
    const inspectorPhone = useMemo(() => {
        if (!phone) return undefined;
        const rowKeys = [...new Set(cells.map((c) => c.row))];
        const key = selected?.key;
        const cell = cells.find((c) => c.key === key);
        let first = 1;
        for (const c of cells) {
            if (c.key === key) break;
            if (c.row === cell?.row) first += Number(c.span);
        }
        const was = saved.find((c) => c.key === key);
        return {
            rows: rowKeys.length, first, dirty: was !== undefined && cell !== undefined && was.span !== cell.span,
            onMove: (moved: string) => {
                setPlacing({ kind: "move", key: moved });
                setCollapsed((c) => ({ ...c, end: true }));
            },
        };
    }, [phone, cells, saved, selected?.key]);
    // Two tabs, 320px wide as the spec's builder draws it — Configure and Layout (#1672); its rail names the selected placement, in the brand
    // while there is one.
    const inspectorTabs = [
        {
            key: "configure", label: m.configure(),
            body: <StudioConfigure value={inspector} saved={savedContent} pages={configurePages} placements={configurePlacements} dnd={wellsDnd}
                phone={inspectorPhone} onLink={linkPlacement} />,
        },
        { key: "layout", label: m.layout(), body: <StudioInspector value={inspector} phone={inspectorPhone} /> },
    ];
    const onInspectorTab = useCallback((key: string) => setInspectorTab(key === "layout" ? "layout" : "configure"), []);
    const inspectorPane = useMemo((): BuilderFrameDock => (inspectorPhone !== undefined ? {
        label: m.inspector(),
        icon: "sliders",
        // The strip's meta: its row, while something is selected (ST21).
        ...(selected === undefined ? {} : { detail: m.phoneRowMeta({ row: words.number(Number(selected.layout.row)) }) }),
        tabs: inspectorTabs,
        tab: inspectorTab,
        onTabChange: onInspectorTab,
    } : {
        label: m.inspector(),
        icon: "sliders",
        badge: selected === undefined ? "" : m.spanBadge({ span: words.number(Number(selected.layout.span)) }),
        active: selected !== undefined,
        detail: selected === undefined ? m.nothingSelected() : selected.name,
        size: "320px",
        tabs: inspectorTabs,
        tab: inspectorTab,
        onTabChange: onInspectorTab,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tabs' bodies are made again with what they read.
    }), [m, words, selected, inspector, inspectorPhone, inspectorTab, savedContent, configurePages, wellsDnd, storageKey, onInspectorTab]);
    // The panes' collapse is the builder's, so a card's tap can close its view; every width's goes through here.
    const panePaletteCollapse = (next: boolean) => {
        setCollapsed((was) => (was.start === next ? was : { ...was, start: next }));
        if (!next && phone) setPlacing(undefined);
    };
    const paneInspectorCollapse = (next: boolean) => {
        setCollapsed((was) => (was.end === next ? was : { ...was, end: next }));
        if (!next && phone) setPlacing(undefined);
    };

    // ── The publish preview, in the canvas's place ───────────────────────
    const summary = useMemo(() => (entry === undefined ? undefined
        : east.publishSummary(components, sourceNames, entry.type === "page" ? entry.value.live : none, { title, cells: [...cells] }, [...saved], entry.type === "template")),
    [east, components, sourceNames, entry, title, cells, saved]);
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
            const patch = east.publish(now, open);
            const outcome = await handle.commit.patch("", patch);
            return east.publishRefusal(outcome);
        },
        onExit: some(() => { setPreviewing(false); return null; }),
    }), [summary, open, title, value.env, value.audience, value.rollout, applying, handle, east]);

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
        <Box ref={widthRef} css={styles.root} data-studio-builder="">
            {/* The canvas's visuals ask their programs over the sources the surface lists (#1670); the preview
                beside it asks through the same answers, so what the canvas has answered it draws at once. */}
            <VisualAnswersProvider sources={sources}>
                {/* The reader's filters of the open page narrow the canvas's visuals as they do the page's. */}
                <PageFiltersProvider page={open}>
                {/* On the canvas a click edits: a visual's own click does not run, and one that follows another reads
                    what the preview's reader selected (#1673). */}
                <PageClicksProvider page={open} cells={cells} live={false}>
                <Box css={styles.canvas} hidden={previewing} data-studio-canvas="" data-linking={linking.active ? "" : undefined}>
                    {linking.surface}
                    <SnapGridEditor
                        value={canvas}
                        storageKey={`${storageKey}.canvas`}
                        toolbar={toolbar}
                        renderContent={renderContent}
                        onEdit={editPlacement}
                        panes={{
                            start: { ...palette, collapsed: collapsed.start, onCollapsedChange: panePaletteCollapse },
                            end: { ...inspectorPane, collapsed: collapsed.end, onCollapsedChange: paneInspectorCollapse },
                        }}
                        phone={{
                            eyebrow: open.project, title, placing, onPlacing: setPlacing,
                            onAdd: () => { setPlacing(undefined); setCollapsed((was) => ({ ...was, start: false })); },
                        }}
                    />
                </Box>
                </PageClicksProvider>
                {/* The preview runs the page as its readers see it (BLD-4): its clicks select, filter and open — a page
                    a click opens is the builder's to show, as its Pages tab opens one. */}
                {previewing && preview !== undefined && (
                    <StudioPublishPreview value={preview}
                        page={<StudioLayout cells={cells} components={components} sources={sources} page={open} storageKey={`${storageKey}.preview`} onOpen={openAnother} />}
                        phone={!phone ? undefined : {
                            tab: previewTab, onTab: setPreviewTab, width,
                            tiles: cells.map((cell) => ({
                                key: cell.key, row: cell.row, span: Number(cell.span),
                                name: cell.title.type === "some" ? cell.title.value : tileOf(cell.content)?.name ?? east.contentWords(cell.content, sourceNames, componentNames),
                            })),
                        }} />
                )}
                </PageFiltersProvider>
            </VisualAnswersProvider>
        </Box>
    );
});

implementUIComponent(StudioBuilderComponent, EastChakraStudioBuilder);

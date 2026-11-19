/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's tile (#1670, #1671): its eyebrow, which names it, says its meta
 * — what its body says of itself (`visual/meta.tsx`) — and holds its
 * menu — Show rows, its rows as a value tree in a popover hanging from the
 * menu, and Export CSV (TIL-2), and on the builder's canvas Edit visual and
 * Duplicate (#1672); its
 * programs printed, asked on e3, and its state drawn (`visual/states.tsx`) —
 * waiting, on the shared
 * loading clock; a well it needs empty; a field its source lacks; a value
 * over another period over a source with no date range, or on a page with no
 * date window; its source's error, with a Retry when asking again may mend
 * it; no rows; or its answer, drawn by its view with the parts' own
 * renderers. What it asks and how is the query layer's (`query/visual/`);
 * what each view shows is `visual/`'s; this draws.
 *
 * A click on its mark, its row or its cell does what its visual says (#1673,
 * LNK-1): its body's parts tell the groups clicked (`visual/clicks.tsx`), and
 * the page's clicks (`page-clicks.tsx`) select, filter or open by them. The
 * filter its own click made narrows every other visual of its source, and it
 * marks the groups that filter holds, never narrowing itself to them. A
 * visual that follows another narrows to what its leader has selected, its
 * eyebrow saying so — the link icon and the selected value — or, with
 * nothing selected, shows everything or asks for a pick (LNK-4, LNK-5).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, Button, Menu as ChakraMenu } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis, faLink } from "@fortawesome/free-solid-svg-icons";
import type { ValueTypeOf } from "@elaraai/east";
import { kindEditor, type StudioCellType, type StudioContentType } from "@elaraai/e3-ui/internal";
import { BannerView, ChipMenu, EmptyStateView, SliceEditPopover, downloadFile, useFormatters } from "@elaraai/east-ui-components";
import { useLoadingReveal, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { resultFileName } from "../query/results.js";
import { useVisualAnswers, useVisualAsk, useVisualSource } from "../query/visual/answers.js";
import { visualReadRows } from "../query/visual/ask.js";
import { followersOf, type Following } from "../query/visual/clicks.js";
import { printVisual, type PrintSource, type VisualAsk } from "../query/visual/print.js";
import { printSourceOf } from "../query/visual/source.js";
import { useQueryWords } from "../query/words.js";
import { messageOf } from "../shared/message.js";
import { useStudioMessages } from "./messages.js";
import { useFollowing, usePageClicks, useTileClicks, useTileState } from "./page-clicks.js";
import { studioEast } from "./studio-east.js";
import { ChartVisual } from "./visual/chart.js";
import { VisualClicksProvider } from "./visual/clicks.js";
import { KpiVisual } from "./visual/kpi.js";
import { RecordsVisual } from "./visual/records.js";
import { recordsCsv, recordsOf, rowsVisual } from "./visual/records-table.js";
import { ListVisual } from "./visual/list.js";
import { TileMeta, TileMetaSlot } from "./visual/meta.js";
import { SourceFailed, VisualNote, problemOf } from "./visual/notes.js";
import { PivotVisual } from "./visual/pivot.js";
import { RowsTree } from "./visual/rows.js";
import { FieldMissing, NoRows, VisualLoading, WellsEmpty } from "./visual/states.js";
import { SummaryVisual } from "./visual/summary.js";
import { fieldLabel, midSentence, pickLabel, visualName, type VisualSource } from "./visual/values.js";

/** A placement's content that is a visual. */
type VisualContent = Extract<ValueTypeOf<typeof StudioContentType>, { type: "visual" }>;
/** A visual. */
type Visual = VisualContent["value"];
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;

/** Whether a view's rows run edge to edge in its tile: a table's and a list's. */
function flush(visual: Visual): boolean {
    return visual.view.type === "table" || visual.view.type === "list";
}

/** What a visual's menu does on the builder's canvas (#1672): its Edit visual and its Duplicate. */
export interface VisualEdit {
    /** Selects the placement and opens its Configure tab. */
    onEdit: () => void;
    /** Places a copy of it after it, selected. */
    onDuplicate: () => void;
    /** Starts linking it on the canvas: a click then picks the visual it follows (#1673, LNK-6). */
    onLink: () => void;
    /** Places a new chart on the next row, on its source, already following it (#1673, LNK-8); `undefined` for a visual nothing can follow. */
    onAddLinked: (() => void) | undefined;
}

/** Props of {@link StudioVisualTile}. */
export interface StudioVisualTileProps {
    /** The visual, as the placement holds it. */
    content: VisualContent;
    /** Each listed source's name, by its key. */
    names: Map<string, string>;
    /** Where its parts keep their state. */
    storageKey: string;
    /** Its placement's own title; `undefined` names it by its wells. */
    title?: string | undefined;
    /** On the builder's canvas, what its menu's Edit visual and Duplicate do; omitted on a page, whose menu has neither. */
    edit?: VisualEdit | undefined;
    /** Its placement's key: what its selection is kept under, and what a visual that follows it names; `undefined` outside a layout. */
    placement?: string | undefined;
    /** While the canvas picks a leader (#1673, LNK-6): whether it is the visual being linked, or one that can lead. */
    pick?: "follower" | "leader" | undefined;
}

/**
 * A placement's name, as its tile's eyebrow says it (TIL-1): its own title,
 * else one made from its wells, else its view.
 */
function useVisualTitle(visual: Visual, title: string | undefined): string {
    const m = useStudioMessages();
    const east = studioEast();
    const source = useVisualSource(visual.source);
    return title ?? (source === undefined ? undefined : visualName(visual.view, source, m)) ?? east.viewWords(visual.view);
}

/** The visual a follower's leader is: the placement's, when it is one. */
function leaderVisual(leader: Cell): Visual | undefined {
    return leader.content.type === "visual" ? leader.content.value : undefined;
}

/** Props of the follower's parts: what it reads of its leader, and the visual. */
interface FollowProps {
    /** What it reads of its leader. */
    following: Exclude<Following, { kind: "removed" }>;
    /** The leader's visual. */
    leader: Visual;
    /** The follower. */
    visual: Visual;
    /** Whether it is drawn where clicks run — a page, the preview; on the builder's canvas it names its leader. */
    live?: boolean | undefined;
}

/**
 * What a follower's eyebrow says of its leader (LNK-4): the link icon, then
 * the selected value — several joined — or that nothing is selected; on the
 * builder's canvas, where nothing is selected by a click, the visual it
 * follows.
 */
function FollowTag({ following, leader, visual, live }: FollowProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const cell = following.leader;
    const name = useVisualTitle(leader, cell.title.type === "some" ? cell.title.value : undefined);
    const said = live === false ? m.followsLeader({ leader: name })
        : following.kind === "selected" ? following.picks.map((pick) => pickLabel(pick, words, m)).join(", ") : m.followNothing();
    return (
        <Box as="span" css={styles.follow} data-studio-visual-follow="" data-following={live === false ? "canvas" : following.kind} data-leader={visual.follow.type === "some" ? visual.follow.value.leader : undefined}
            title={m.followsName({ leader: name, selected: said })}>
            <FontAwesomeIcon icon={faLink} />
            <span>{said}</span>
        </Box>
    );
}

/** A follower that asks for a pick, with nothing selected on its leader (LNK-5): what to pick, and where. */
function FollowPrompt({ following, leader, visual }: FollowProps) {
    const m = useStudioMessages();
    const cell = following.leader;
    const name = useVisualTitle(leader, cell.title.type === "some" ? cell.title.value : undefined);
    const source = useVisualSource(leader.source);
    const from = visual.follow.type === "some" ? visual.follow.value.from : "";
    const field = midSentence(source === undefined ? from : fieldLabel(source, from));
    return <EmptyStateView icon={{ prefix: "fas", name: "link" }} title={m.followPrompt({ field, leader: name })} description={m.followPromptHint({ field })} />;
}

/**
 * A visual's tile: its eyebrow (TIL-1) — its placement's title, else a name
 * made from its wells (`Revenue by month`), else, while those are empty, its
 * view (`Column chart`) — with its meta and its menu at the end; then its
 * state, as its programs print and answer, which says the meta.
 *
 * @param props - The visual, the sources' names, where its parts keep their state, its title, its placement's key, and on the canvas its edits
 * @returns The tile's content
 */
export function StudioVisualTile({ content, names, storageKey, title, edit, placement, pick }: StudioVisualTileProps) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioVisual");
    const east = studioEast();
    const visual = content.value;
    const source = useVisualSource(visual.source);
    const read = useMemo(() => (source === undefined ? undefined : printSourceOf(source)), [source]);
    const sourceName = east.sourceName(visual.source, names);
    const name = useVisualTitle(visual, title);
    // What its clicks do, and what it reads of the visual it follows.
    const clicks = useTileClicks(placement, visual);
    const following = useFollowing(visual);
    // On the builder's canvas, where a click edits: a follower names its leader, and a leader says how many follow it.
    const page = usePageClicks();
    const live = page?.live;
    const led = page === undefined || page.live || placement === undefined ? 0 : followersOf(page.cells, placement).length;
    const f = useFormatters();
    const leader = following === undefined || following.kind === "removed" ? undefined : leaderVisual(following.leader);
    // An export that failed, said over the body until it is put away.
    const [failed, setFailed] = useState<string | undefined>(undefined);
    // The eyebrow's meta slot, which the body's part draws its meta in.
    const [metaSlot, setMetaSlot] = useState<HTMLElement | null>(null);
    return (
        <Box css={styles.tile} data-studio-visual-tile="" data-studio-placement={placement} data-pick={pick}>
            <Box css={styles.head} data-studio-visual-head="">
                {/* Its name, cut with an ellipsis in a narrow tile: whole on hover (#1692). */}
                <Box as="span" css={styles.name} data-studio-visual-name="" title={name}>{name}</Box>
                <Box css={styles.end}>
                    {led > 0 && (
                        <Box as="span" css={styles.follow} data-studio-visual-leads={led} data-following="canvas">
                            <FontAwesomeIcon icon={faLink} />
                            <span>{m.leads({ count: f.number(led) })}</span>
                        </Box>
                    )}
                    {following !== undefined && following.kind !== "removed" && leader !== undefined && <FollowTag following={following} leader={leader} visual={visual} live={live} />}
                    {following?.kind === "removed" && (
                        <Box as="span" css={styles.follow} data-studio-visual-follow="" data-following="removed">
                            <FontAwesomeIcon icon={faLink} />
                            <span>{m.followRemoved()}</span>
                        </Box>
                    )}
                    <Box as="span" css={styles.meta} data-studio-visual-meta="" ref={setMetaSlot} />
                    {((source !== undefined && read !== undefined) || edit !== undefined) && (
                        <VisualMenu visual={visual} name={name} source={source} read={read} storageKey={storageKey} onFailed={setFailed} edit={edit} placement={placement} />
                    )}
                </Box>
            </Box>
            <Box css={styles.body} data-studio-visual-body="" data-flush={flush(visual) ? "" : undefined}>
                {failed !== undefined && (
                    <BannerView status="error" title={m.exportFailed()} description={failed}
                        actions={<Button size="xs" variant="outline" onClick={() => setFailed(undefined)}>{m.dismiss()}</Button>} />
                )}
                <TileMetaSlot value={metaSlot}>
                    <VisualClicksProvider value={clicks}>
                        {/* A follower that asks for a pick draws its prompt until its leader has one (LNK-5). */}
                        {following !== undefined && following.kind !== "selected" && visual.follow.type === "some" && visual.follow.value.empty.type === "prompt"
                            ? (
                                <>
                                    <TileMeta>{sourceName}</TileMeta>
                                    {following.kind === "removed" || leader === undefined
                                        ? <EmptyStateView icon={{ prefix: "fas", name: "link-slash" }} title={m.followGone()} description={m.followGoneHint()} />
                                        : <FollowPrompt following={following} leader={leader} visual={visual} />}
                                </>
                            )
                            : <VisualBody visual={visual} source={source} read={read} sourceName={sourceName} storageKey={storageKey} onPick={edit?.onEdit} placement={placement} />}
                    </VisualClicksProvider>
                </TileMetaSlot>
            </Box>
        </Box>
    );
}

/** Props of {@link VisualMenu}. */
interface VisualMenuProps {
    /** The visual. */
    visual: Visual;
    /** Its name, as its eyebrow says it: whose rows the popover's head says they are, and the file's. */
    name: string;
    /** Its source, as the surface lists it; `undefined` while it lists none of its key, which has no rows to show. */
    source: VisualSource | undefined;
    /** Its source, as the printer reads it; `undefined` with none. */
    read: PrintSource | undefined;
    /** Where its parts keep their state. */
    storageKey: string;
    /** Told why an export failed. */
    onFailed: (message: string | undefined) => void;
    /** On the builder's canvas, its Edit visual and Duplicate. */
    edit: VisualEdit | undefined;
    /** Its placement's key: the filter its own click made is no narrowing of its rows; `undefined` outside a layout. */
    placement: string | undefined;
}

/**
 * A visual's menu (TIL-2): Show rows — the rows under it, without its
 * grouping, as a value tree in a popover hanging from the menu, read a page
 * at a time, how many there are and Export CSV at its foot — and Export CSV,
 * the same rows, every one, as a file named after it; on the builder's
 * canvas, Edit visual and Duplicate after them (#1672).
 *
 * The rows open in a popover, never a drawer: the app's design keeps the
 * Drawer for its rail on a phone.
 */
function VisualMenu({ visual, name, source, read, storageKey, onFailed, edit, placement }: VisualMenuProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const f = useFormatters();
    const ask = useVisualAsk(visual.source);
    const state = useTileState(visual, read, placement);
    const [showing, setShowing] = useState(false);
    const rows = useMemo(() => (source === undefined || read === undefined ? undefined : rowsVisual(visual, source, read)), [visual, source, read]);
    // Every row, asked once through the page's answers, written as CSV.
    const exportRows = useCallback(async () => {
        if (rows === undefined || read === undefined) return;
        const records = recordsOf(rows);
        const printed = printVisual(rows, read, state, { offset: 0, size: "all" });
        if (records === undefined || printed.kind !== "asks") return;
        onFailed(undefined);
        try {
            const [answer] = await ask(printed.asks);
            if (answer === undefined) return;
            if (answer.kind === "problem") {
                onFailed(problemOf(answer, m));
                return;
            }
            downloadFile(`${resultFileName(name)}.csv`, "text/csv;charset=utf-8", recordsCsv(records, answer, words));
        } catch (err) {
            onFailed(messageOf(err));
        }
    }, [rows, read, state, ask, name, words, m, onFailed]);
    // How many rows there are, as the open popover's tree learns it.
    const [total, setTotal] = useState<number | undefined>(undefined);
    const csv: ReactNode = <Button size="xs" variant="outline" onClick={() => { void exportRows(); }} data-studio-export="">{m.exportCsv()}</Button>;
    const menu = (
        <ChipMenu label={m.visualMenu()} icon={faEllipsis} bare data="data-studio-visual-menu" onSelect={(picked) => {
            if (picked === "rows") setShowing(true);
            else if (picked === "csv") void exportRows();
            else if (picked === "edit") edit?.onEdit();
            else if (picked === "duplicate") edit?.onDuplicate();
            else if (picked === "link") edit?.onLink();
            else if (picked === "add-linked") edit?.onAddLinked?.();
        }}>
            {rows !== undefined && <ChakraMenu.Item value="rows">{m.showRows()}</ChakraMenu.Item>}
            {rows !== undefined && <ChakraMenu.Item value="csv">{m.exportCsv()}</ChakraMenu.Item>}
            {edit !== undefined && rows !== undefined && <ChakraMenu.Separator />}
            {edit !== undefined && <ChakraMenu.Item value="edit">{m.editVisual()}</ChakraMenu.Item>}
            {edit !== undefined && <ChakraMenu.Item value="duplicate">{m.duplicate()}</ChakraMenu.Item>}
            {edit !== undefined && <ChakraMenu.Item value="link">{m.linkOnCanvas()}</ChakraMenu.Item>}
            {edit?.onAddLinked !== undefined && <ChakraMenu.Item value="add-linked">{m.addLinked()}</ChakraMenu.Item>}
        </ChipMenu>
    );
    if (rows === undefined || source === undefined || read === undefined) return menu;
    return (
        <SliceEditPopover open={showing} onOpenChange={setShowing} label={m.rowsOf({ name })} size="lg" flush anchor={menu}
            footLeft={total === undefined ? undefined : <VisualNote>{m.rowsCount({ n: total, count: f.number(total) })}</VisualNote>}
            footActions={csv}>
            {showing && (
                <Box data-studio-rows="">
                    <RowsTree visual={rows} source={source} read={read} state={state} storageKey={`${storageKey}.rows`} onTotal={setTotal} />
                </Box>
            )}
        </SliceEditPopover>
    );
}

/** Props of {@link VisualBody}. */
interface VisualBodyProps {
    /** The visual. */
    visual: Visual;
    /** Its source, as the surface lists it; `undefined` when it lists none of its key. */
    source: VisualSource | undefined;
    /** Its source, as the printer reads it; `undefined` with none. */
    read: PrintSource | undefined;
    /** Its source's name. */
    sourceName: string;
    /** Where its parts keep their state. */
    storageKey: string;
    /** Opens its fields, to pick another for one its source lacks: on the builder's canvas, its Configure tab; `undefined` on a published page. */
    onPick: (() => void) | undefined;
    /** Its placement's key: the filter its own click made is no narrowing of it; `undefined` outside a layout. */
    placement: string | undefined;
}

/** A visual's body: its state, as its programs print and answer. */
function VisualBody({ visual, source, read, sourceName, storageKey, onPick, placement }: VisualBodyProps) {
    const m = useStudioMessages();
    const east = studioEast();
    const state = useTileState(visual, read, placement);
    const printed = useMemo(() => (read === undefined ? undefined : printVisual(visual, read, state)), [visual, read, state]);
    const icon = east.viewIcon(visual.view);
    // Until a visual draws, its meta is its source's name — but for a missing field, which it says.
    const named = <TileMeta>{sourceName}</TileMeta>;
    if (printed === undefined || source === undefined || read === undefined) {
        return <>{named}<EmptyStateView icon={{ prefix: "fas", name: "database" }} title={m.noSource({ key: visual.source })} description={m.noSourceHint()} /></>;
    }
    switch (printed.kind) {
        case "empty": {
            // Each well it needs, by its kind's declaration: its label, and whether a value fills it (#1672).
            const wells = kindEditor(visual.view)?.wells ?? [];
            const needed = printed.wells.map((field) => {
                const well = wells.find((w) => w.field === field);
                return m.wellNeeded({ label: well?.label ?? field, value: well?.holds.type === "value" || well?.holds.type === "axis" });
            });
            return <>{named}<WellsEmpty icon={icon} needed={needed} /></>;
        }
        case "missing":
            return <><TileMeta>{m.metaNeedsField()}</TileMeta><FieldMissing source={sourceName} fields={printed.fields} onPick={onPick} /></>;
        case "range":
            return <>{named}<EmptyStateView icon={{ prefix: "fas", name: "calendar" }} title={m.noRange({ source: sourceName })} description={m.noRangeHint()} /></>;
        case "window":
            return <>{named}<EmptyStateView icon={{ prefix: "fas", name: "calendar" }} title={m.needsWindow({ source: sourceName })} description={m.needsWindowHint()} /></>;
        case "asks":
            return <AskedVisual asks={printed.asks} visual={visual} listed={source} read={read} sourceName={sourceName} icon={icon} storageKey={storageKey} placement={placement} />;
    }
}

/** Props of {@link AskedVisual}. */
interface AskedVisualProps {
    asks: readonly VisualAsk[];
    visual: Visual;
    listed: VisualSource;
    read: PrintSource;
    sourceName: string;
    icon: string;
    storageKey: string;
    placement: string | undefined;
}

/** A visual whose programs are asked: waiting, failed, no rows, or its answer drawn. */
function AskedVisual({ asks, visual, listed, read, sourceName, icon, storageKey, placement }: AskedVisualProps) {
    const m = useStudioMessages();
    const words = useFormatters();
    const asked = useVisualAnswers(asks, visual.source);
    const state = useTileState(visual, read, placement);
    const shown = useLoadingReveal(asked.status === "waiting");
    switch (asked.status) {
        case "waiting":
            // Once the loading clock says so: blocks in its own shape, and its meta says it is loading.
            return shown ? <><TileMeta>{m.metaLoading()}</TileMeta><VisualLoading view={visual.view} /></> : null;
        case "failed":
            return <><TileMeta>{sourceName}</TileMeta><SourceFailed source={sourceName} message={asked.message} retry={asked.retry} /></>;
        case "answered": {
            const problem = asked.answers.find((answer) => answer.kind === "problem");
            if (problem !== undefined && problem.kind === "problem") return <><TileMeta>{sourceName}</TileMeta><SourceFailed source={sourceName} message={problemOf(problem, m)} /></>;
            // No data when no program read a row — every period's, not the first's alone.
            const read_ = asked.answers.find((answer) => answer.kind === "answered" && answer.n > 0);
            if (!visualReadRows(asked.answers) || read_ === undefined || read_.kind !== "answered") {
                return <NoRows reason={m.noDataReason({ rows: midSentence(sourceName) })} />;
            }
            const view = visual.view;
            switch (view.type) {
                case "kpi": return <KpiVisual kpi={view.value} asks={asks} answers={asked.answers} source={listed} />;
                case "chart": return <ChartVisual chart={view.value} asks={asks} answers={asked.answers} source={listed} />;
                case "table":
                    switch (view.value.type) {
                        case "records": return <RecordsVisual visual={visual} source={listed} read={read} state={state} storageKey={storageKey} />;
                        case "summary": return <SummaryVisual summary={view.value.value} asks={asks} answers={asked.answers} source={listed} storageKey={storageKey} />;
                        case "pivot": return <PivotVisual pivot={view.value.value} asks={asks} answers={asked.answers} source={listed} storageKey={storageKey} />;
                    }
                    break;
                case "list": return <ListVisual list={view.value} asks={asks} answers={asked.answers} source={listed} />;
                default:
                    break;
            }
            return (
                <EmptyStateView icon={{ prefix: "fas", name: icon }}
                    title={m.answerGroups({ n: read_.groups, groups: words.number(read_.groups), nr: read_.n, rows: words.number(read_.n) })} />
            );
        }
    }
}

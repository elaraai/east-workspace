/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's tile (#1670, #1671): its eyebrow, which names it and holds its
 * menu — Show rows, its rows in the drawer, and Export CSV (TIL-2); its
 * programs printed, asked on e3, and its state drawn — waiting, on the shared
 * loading clock; a well it needs empty; a field its source lacks; a value
 * over another period over a source with no date range, or on a page with no
 * date window; its source's error, with a Retry when asking again may mend
 * it; no rows; or its answer, drawn by its view with the parts' own
 * renderers. What it asks and how is the query layer's (`query/visual/`);
 * what each view shows is `visual/`'s; this draws.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, Button, Menu as ChakraMenu } from "@chakra-ui/react";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { StudioContentType } from "@elaraai/e3-ui/internal";
import {
    BannerView, ChipMenu, EastChakraSkeleton, EmptyStateView, downloadFile, useFormatters, type SkeletonValue,
} from "@elaraai/east-ui-components";
import { DrawerContent, useLoadingReveal, useSlotStyles, type DrawerOpenInputValue } from "@elaraai/east-ui-components/internal";
import { resultFileName } from "../query/results.js";
import { useVisualAnswers, useVisualAsk, useVisualSource } from "../query/visual/answers.js";
import { visualReadRows, type VisualAnswer } from "../query/visual/ask.js";
import { printVisual, type PrintSource, type PrintState, type VisualAsk } from "../query/visual/print.js";
import { printSourceOf } from "../query/visual/source.js";
import { useQueryWords } from "../query/words.js";
import { messageOf } from "../shared/message.js";
import { useStudioMessages, type StudioMessages } from "./messages.js";
import { studioEast } from "./studio-east.js";
import { ChartVisual } from "./visual/chart.js";
import { KpiVisual } from "./visual/kpi.js";
import { RecordsVisual } from "./visual/records.js";
import { recordsCsv, recordsOf, rowsVisual } from "./visual/records-table.js";
import { ListVisual } from "./visual/list.js";
import { SourceFailed } from "./visual/notes.js";
import { PivotVisual } from "./visual/pivot.js";
import { SummaryVisual } from "./visual/summary.js";
import { visualName, type VisualSource } from "./visual/values.js";

/** A placement's content that is a visual. */
type VisualContent = Extract<ValueTypeOf<typeof StudioContentType>, { type: "visual" }>;
/** A visual. */
type Visual = VisualContent["value"];

/** The page's state as a visual's programs read it: no filters, no window, until the page's filters land. */
const NO_STATE: PrintState = { filters: [] };

/** What a waiting tile shows once the loading clock says so: three lines of placeholder. */
const WAITING: SkeletonValue = { shape: variant("text", null), lines: some(3n), count: none, style: none };

/** Whether a view's rows run edge to edge in its tile: a table's and a list's. */
function flush(visual: Visual): boolean {
    return visual.view.type === "table" || visual.view.type === "list";
}

/** What a program that ended without answering says: its first problem, else that it stopped. */
function problemOf(answer: Extract<VisualAnswer, { kind: "problem" }>, m: StudioMessages): string {
    const outcome = answer.result.outcome;
    return (outcome.type === "error" ? outcome.value[0]?.message : undefined) ?? m.answerStopped();
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
}

/**
 * A visual's tile: its eyebrow (TIL-1) — its placement's title, else a name
 * made from its wells (`Revenue by month`), else, while those are empty, its
 * view (`Column chart`) — with its source and its menu at the end; then its
 * state, as its programs print and answer.
 *
 * @param props - The visual, the sources' names, where its parts keep their state, and its title
 * @returns The tile's content
 */
export function StudioVisualTile({ content, names, storageKey, title }: StudioVisualTileProps) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioVisual");
    const east = studioEast();
    const visual = content.value;
    const source = useVisualSource(visual.source);
    const read = useMemo(() => (source === undefined ? undefined : printSourceOf(source)), [source]);
    const sourceName = east.sourceName(visual.source, names);
    const name = title ?? (source === undefined ? undefined : visualName(visual.view, source, m)) ?? east.viewWords(visual.view);
    // An export that failed, said over the body until it is put away.
    const [failed, setFailed] = useState<string | undefined>(undefined);
    return (
        <Box css={styles.tile} data-studio-visual-tile="">
            <Box css={styles.head} data-studio-visual-head="">
                <Box as="span" css={styles.name} data-studio-visual-name="">{name}</Box>
                <Box css={styles.end}>
                    <Box as="span" css={styles.meta} data-studio-visual-meta="">{sourceName}</Box>
                    {source !== undefined && read !== undefined && (
                        <VisualMenu visual={visual} name={name} source={source} read={read} storageKey={storageKey} onFailed={setFailed} />
                    )}
                </Box>
            </Box>
            <Box css={styles.body} data-studio-visual-body="" data-flush={flush(visual) ? "" : undefined}>
                {failed !== undefined && (
                    <BannerView status="error" title={m.exportFailed()} description={failed}
                        actions={<Button size="xs" variant="outline" onClick={() => setFailed(undefined)}>{m.dismiss()}</Button>} />
                )}
                <VisualBody visual={visual} source={source} read={read} sourceName={sourceName} storageKey={storageKey} />
            </Box>
        </Box>
    );
}

/** Props of {@link VisualMenu}. */
interface VisualMenuProps {
    /** The visual. */
    visual: Visual;
    /** Its name, as its eyebrow says it: the drawer's title and the file's. */
    name: string;
    /** Its source, as the surface lists it. */
    source: VisualSource;
    /** Its source, as the printer reads it. */
    read: PrintSource;
    /** Where its parts keep their state. */
    storageKey: string;
    /** Told why an export failed. */
    onFailed: (message: string | undefined) => void;
}

/**
 * A visual's menu (TIL-2): Show rows — the rows under it, without its
 * grouping, a records table in the drawer, with Export CSV under them — and
 * Export CSV, the same rows, every one, as a file named after it.
 */
function VisualMenu({ visual, name, source, read, storageKey, onFailed }: VisualMenuProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const ask = useVisualAsk(visual.source);
    const [showing, setShowing] = useState(false);
    const rows = useMemo(() => rowsVisual(visual, source, read), [visual, source, read]);
    // Every row, asked once through the page's answers, written as CSV.
    const exportRows = useCallback(async () => {
        const records = recordsOf(rows);
        const printed = printVisual(rows, read, NO_STATE, { offset: 0, size: "all" });
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
    }, [rows, read, ask, name, words, m, onFailed]);
    const drawer = useMemo((): DrawerOpenInputValue => ({
        body: [],
        eyebrow: some(m.rowsEyebrow()),
        title: some(name),
        description: none,
        style: some({
            size: some(variant("lg", null)), placement: some(variant("end", null)), contained: none, open: none, defaultOpen: none,
            closeOnInteractOutside: none, closeOnEscape: none, lazyMount: none, unmountOnExit: none, onOpenChange: none,
            onExitComplete: none, bodyPadding: none, flush: some(true), fillBody: some(true), stacked: none, stackIcon: none,
        }),
    }), [m, name]);
    const csv: ReactNode = <Button size="xs" variant="outline" onClick={() => { void exportRows(); }} data-studio-export="">{m.exportCsv()}</Button>;
    return (
        <>
            <ChipMenu label={m.visualMenu()} icon={faEllipsis} bare data="data-studio-visual-menu" onSelect={(picked) => {
                if (picked === "rows") setShowing(true);
                else if (picked === "csv") void exportRows();
            }}>
                <ChakraMenu.Item value="rows">{m.showRows()}</ChakraMenu.Item>
                <ChakraMenu.Item value="csv">{m.exportCsv()}</ChakraMenu.Item>
            </ChipMenu>
            {showing && (
                <DrawerContent value={drawer} storageKey={`${storageKey}.rows`} open onClose={() => setShowing(false)}>
                    <RecordsVisual visual={rows} source={source} read={read} state={NO_STATE} storageKey={`${storageKey}.rows`} action={csv} />
                </DrawerContent>
            )}
        </>
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
}

/** A visual's body: its state, as its programs print and answer. */
function VisualBody({ visual, source, read, sourceName, storageKey }: VisualBodyProps) {
    const m = useStudioMessages();
    const east = studioEast();
    const printed = useMemo(() => (read === undefined ? undefined : printVisual(visual, read, NO_STATE)), [visual, read]);
    const icon = east.viewIcon(visual.view);
    if (printed === undefined || source === undefined || read === undefined) {
        return <EmptyStateView icon={{ prefix: "fas", name: "database" }} title={m.noSource({ key: visual.source })} description={m.noSourceHint()} />;
    }
    switch (printed.kind) {
        case "none":
            return <EmptyStateView icon={{ prefix: "fas", name: icon }} title={east.viewWords(visual.view)} />;
        case "empty":
            return <EmptyStateView icon={{ prefix: "fas", name: icon }} title={m.wellsEmpty()} description={printed.wells.map((well) => m.wellNeeded({ well })).join(" · ")} />;
        case "missing":
            return <EmptyStateView icon={{ prefix: "fas", name: "circle-exclamation" }}
                title={m.fieldMissing({ source: sourceName, field: printed.fields.join(", ") })} description={m.fieldMissingHint()} />;
        case "range":
            return <EmptyStateView icon={{ prefix: "fas", name: "calendar" }} title={m.noRange({ source: sourceName })} description={m.noRangeHint()} />;
        case "window":
            return <EmptyStateView icon={{ prefix: "fas", name: "calendar" }} title={m.needsWindow({ source: sourceName })} description={m.needsWindowHint()} />;
        case "asks":
            return <AskedVisual asks={printed.asks} visual={visual} listed={source} read={read} sourceName={sourceName} icon={icon} storageKey={storageKey} />;
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
}

/** A visual whose programs are asked: waiting, failed, no rows, or its answer drawn. */
function AskedVisual({ asks, visual, listed, read, sourceName, icon, storageKey }: AskedVisualProps) {
    const m = useStudioMessages();
    const words = useFormatters();
    const asked = useVisualAnswers(asks, visual.source);
    const shown = useLoadingReveal(asked.status === "waiting");
    switch (asked.status) {
        case "waiting":
            return shown ? <Box data-studio-visual="waiting"><EastChakraSkeleton value={WAITING} /></Box> : null;
        case "failed":
            return <SourceFailed source={sourceName} message={asked.message} retry={asked.retry} />;
        case "answered": {
            const problem = asked.answers.find((answer) => answer.kind === "problem");
            if (problem !== undefined && problem.kind === "problem") return <SourceFailed source={sourceName} message={problemOf(problem, m)} />;
            // No data when no program read a row — every period's, not the first's alone.
            const read_ = asked.answers.find((answer) => answer.kind === "answered" && answer.n > 0);
            if (!visualReadRows(asked.answers) || read_ === undefined || read_.kind !== "answered") {
                return <EmptyStateView icon={{ prefix: "fas", name: icon }} title={m.noData()} description={m.noDataReason({ source: sourceName })} />;
            }
            const view = visual.view;
            switch (view.type) {
                case "kpi": return <KpiVisual kpi={view.value} asks={asks} answers={asked.answers} source={listed} />;
                case "chart": return <ChartVisual chart={view.value} asks={asks} answers={asked.answers} source={listed} />;
                case "table":
                    switch (view.value.type) {
                        case "records": return <RecordsVisual visual={visual} source={listed} read={read} state={NO_STATE} storageKey={storageKey} />;
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

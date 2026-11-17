/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's tile (#1670): its programs printed, asked on e3, and its state
 * drawn — waiting, on the shared loading clock; a well it needs empty; a
 * field its source lacks; a value over another period over a source with no
 * date range, or on a page with no date window; its source's error, with a
 * Retry when asking again may mend it; no rows; or its answer's size, until
 * the tiles that draw it land. What it asks and how is the query layer's
 * (`query/visual/`); this draws.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { StudioContentType } from "@elaraai/e3-ui/internal";
import { Box, Button } from "@chakra-ui/react";
import { BannerView, EastChakraSkeleton, EmptyStateView, useFormatters, type SkeletonValue } from "@elaraai/east-ui-components";
import { useLoadingReveal } from "@elaraai/east-ui-components/internal";
import { useVisualAnswers, useVisualSource } from "../query/visual/answers.js";
import { visualReadRows } from "../query/visual/ask.js";
import { printVisual, type PrintState, type VisualAsk } from "../query/visual/print.js";
import { printSourceOf } from "../query/visual/source.js";
import { useStudioMessages } from "./messages.js";
import { studioEast } from "./studio-east.js";

/** A placement's content that is a visual. */
type VisualContent = Extract<ValueTypeOf<typeof StudioContentType>, { type: "visual" }>;

/** The page's state as a visual's programs read it: no filters, no window, until the page's filters land. */
const NO_STATE: PrintState = { filters: [] };

/** What a waiting tile shows once the loading clock says so: three lines of placeholder. */
const WAITING: SkeletonValue = { shape: variant("text", null), lines: some(3n), count: none, style: none };

/** Props of {@link StudioVisualTile}. */
export interface StudioVisualTileProps {
    /** The visual, as the placement holds it. */
    content: VisualContent;
    /** Each listed source's name, by its key. */
    names: Map<string, string>;
}

/**
 * A visual's tile: its state, as its programs print and answer.
 *
 * @param props - The visual and the sources' names
 * @returns The tile's content
 */
export function StudioVisualTile({ content, names }: StudioVisualTileProps) {
    const m = useStudioMessages();
    const east = studioEast();
    const visual = content.value;
    const source = useVisualSource(visual.source);
    const printed = useMemo(() => {
        const read = source === undefined ? undefined : printSourceOf(source);
        return read === undefined ? undefined : printVisual(visual, read, NO_STATE);
    }, [visual, source]);
    const sourceName = east.sourceName(visual.source, names);
    const icon = east.viewIcon(visual.view);
    if (printed === undefined) {
        return <EmptyStateView icon={{ prefix: "fas", name: "database" }} title={m.noSource({ key: visual.source })} description={m.noSourceHint()} />;
    }
    switch (printed.kind) {
        case "none":
            return <EmptyStateView icon={{ prefix: "fas", name: icon }} title={east.visualWords(visual, names)} />;
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
            return <AskedVisual asks={printed.asks} source={visual.source} sourceName={sourceName} title={east.visualWords(visual, names)} icon={icon} />;
    }
}

/** Props of {@link AskedVisual}. */
interface AskedVisualProps {
    asks: readonly VisualAsk[];
    source: string;
    sourceName: string;
    title: string;
    icon: string;
}

/** A visual whose programs are asked: waiting, failed, no rows, or its answer's size. */
function AskedVisual({ asks, source, sourceName, title, icon }: AskedVisualProps) {
    const m = useStudioMessages();
    const words = useFormatters();
    const asked = useVisualAnswers(asks, source);
    const shown = useLoadingReveal(asked.status === "waiting");
    switch (asked.status) {
        case "waiting":
            return shown ? <Box data-studio-visual="waiting"><EastChakraSkeleton value={WAITING} /></Box> : null;
        case "failed": {
            const retry = asked.retry;
            return (
                <BannerView status="error" title={m.sourceError({ source: sourceName })} description={asked.message}
                    actions={retry === undefined ? undefined : <Button size="xs" variant="outline" onClick={retry}>{m.retry()}</Button>} />
            );
        }
        case "answered": {
            const problem = asked.answers.find((answer) => answer.kind === "problem");
            if (problem !== undefined) {
                const outcome = problem.result.outcome;
                const said = outcome.type === "error" ? outcome.value[0]?.message : undefined;
                return <BannerView status="error" title={m.sourceError({ source: sourceName })} description={said ?? m.answerStopped()} />;
            }
            // No data when no program read a row — every period's, not the first's alone.
            const read = asked.answers.find((answer) => answer.kind === "answered" && answer.n > 0);
            if (!visualReadRows(asked.answers) || read === undefined || read.kind !== "answered") {
                return <EmptyStateView icon={{ prefix: "fas", name: icon }} title={m.noData()} description={m.noDataReason({ source: sourceName })} />;
            }
            return (
                <EmptyStateView icon={{ prefix: "fas", name: icon }} title={title}
                    description={m.answerGroups({ n: read.groups, groups: words.number(read.groups), nr: read.n, rows: words.number(read.n) })} />
            );
        }
    }
}

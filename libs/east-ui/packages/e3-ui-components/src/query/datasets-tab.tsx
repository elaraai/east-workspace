/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pane's Datasets tab (#939, `Query Editor Spec.md` §4.9) — the data
 * sources the builder is handed, as a `Library`, as Studio's Components tab is
 * one of the components a surface lists:
 *
 * - **groups** by kind: Rows (lists), Lookups (lookup tables), Values (trees
 *   and records) and Models (calculations), each with its count;
 * - **an item**: its kind's icon, its name, and under it its size and its
 *   hash — "40 orders · #4f2a1c8d", "8 customers by ID", "one tree", "price,
 *   region → number" — the count of a list or a lookup table and the hash from
 *   the dataset's status on e3, once it loads; and, trailing, **Source** or
 *   **Looked up** where the open query reads it, the item placed;
 * - **a click** starts a new query on it.
 *
 * With no e3 server — a test, an offline host — nothing is fetched, and an
 * item says only what its type says.
 *
 * @packageDocumentation
 */

import { memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { none, some, type EastType } from "@elaraai/east";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import { pathToString } from "@elaraai/e3-types";
import { EastChakraLibrary, type LibraryItemValue, type LibraryValue } from "@elaraai/east-ui-components";
import { useE3ConfigOptional, type E3Config } from "../platform/e3-config.js";
import { human, plainKind, plural, type QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { optionPayload, singular } from "./steps/shape.js";
import { fromEastTypeValue } from "@elaraai/east";

/** A kind of data source: the Datasets tab's group. */
export type SourceKind = "rows" | "lookups" | "values" | "models";

/** The groups, in the order the tab shows them. */
const KIND_ORDER: readonly SourceKind[] = ["rows", "lookups", "values", "models"];

/** How the open query reads a data source: as its source, or looked up. */
export type SourceRole = "source" | "lookedUp";

/** What e3's status says of a data source: how many rows it holds, when it counts them, and its hash. */
export interface SourceStatus {
    /** How many elements a stored list or lookup table holds. */
    readonly rows: number | undefined;
    /** The hash of its value. */
    readonly hash: string | undefined;
}

/** How many characters of a hash an item shows. */
const HASH_CHARS = 8;

/**
 * What a data source is, by its type: its group and its icon.
 *
 * @param type - its type
 * @returns the group and the icon
 */
export function sourceKind(type: EastType): { kind: SourceKind; icon: string } {
    const payload = optionPayload(type);
    if (payload !== undefined) return sourceKind(payload);
    switch (type.type) {
        case "Array": case "Set": case "Vector": return { kind: "rows", icon: "table-list" };
        case "Dict": return { kind: "lookups", icon: "key" };
        case "Recursive": return { kind: "values", icon: "sitemap" };
        case "Function": case "AsyncFunction": return { kind: "models", icon: "calculator" };
        default: return { kind: "values", icon: "cube" };
    }
}

/**
 * A data source's size in words: a list's or a lookup table's count, once its
 * status gives one; a tree, a record, a calculation's inputs and result, or a
 * value's kind otherwise.
 *
 * @param name - its name, which names its items
 * @param type - its type
 * @param rows - how many elements its status counts, if it does
 * @param words - the words
 * @returns the size, or `""` for a list or a lookup table not counted yet
 */
export function sourceSize(name: string, type: EastType, rows: number | undefined, words: QueryWords): string {
    const m = words.messages;
    const payload = optionPayload(type);
    if (payload !== undefined) return sourceSize(name, payload, rows, words);
    const noun = (n: number): string => (n === 1 ? human(singular(name)) : plural(human(singular(name))));
    switch (type.type) {
        case "Array": case "Set": case "Vector":
            return rows === undefined ? "" : m.sourceRows({ count: words.formatters.number(rows), noun: noun(rows) });
        case "Dict":
            return rows === undefined ? "" : m.sourceLookup({ count: words.formatters.number(rows), noun: noun(rows) });
        case "Recursive":
            return m.sourceTree();
        case "Function": case "AsyncFunction": {
            const inputs = type.inputs as EastType[];
            const only = inputs.length === 1 ? inputs[0]! : undefined;
            const names = only !== undefined && only.type === "Struct"
                ? Object.keys(only.fields as Record<string, EastType>).map(human)
                : inputs.map((input) => plainKind(input, words));
            return m.sourceModel({ inputs: m.list({ items: names }).replace(/ and /, ", "), output: plainKind(type.output as EastType, words) });
        }
        case "Struct":
            return m.sourceRecord();
        default:
            return plainKind(type, words);
    }
}

/** Props of {@link DatasetsTab}. */
export interface DatasetsTabProps {
    /** The data sources, as the root holds them. */
    readonly root: QueryRoot;
    /** How the open query reads each data source it reads, by name. */
    readonly reads: ReadonlyMap<string, SourceRole>;
    /** Starts a new query on a data source. */
    readonly onStart: (name: string) => void;
    /** The tab's library's id. */
    readonly id: string;
    /** The words. */
    readonly words: QueryWords;
    /** Where the library keeps its state. */
    readonly storageKey: string;
}

/** No statuses: a host with no e3 server. */
const NO_STATUSES: ReadonlyMap<string, SourceStatus> = new Map();

/**
 * Renders the Datasets tab — see the module docs.
 *
 * @param props - The data sources, how the open query reads them, and what a click does ({@link DatasetsTabProps})
 * @returns The tab's library
 */
export const DatasetsTab = memo(function DatasetsTab(props: DatasetsTabProps) {
    const config = useE3ConfigOptional();
    // Statuses come from e3 through the provider's query client; with none, there is nothing to ask.
    if (config === null || config.workspace === undefined) return <DatasetsLibrary {...props} statuses={NO_STATUSES} />;
    return <DatasetsWithStatus {...props} config={config} workspace={config.workspace} />;
});

/** The tab over e3: each data source's status fetched, and the library over them. */
function DatasetsWithStatus({ config, workspace, ...props }: DatasetsTabProps & { config: E3Config; workspace: string }) {
    const { apiUrl, token } = config;
    const repo = config.repo ?? "default";
    const results = useQueries({
        queries: props.root.entries.map((entry) => ({
            queryKey: ["querySourceStatus", apiUrl, repo, workspace, pathToString(entry.path)],
            queryFn: () => datasetGetStatus(apiUrl, repo, workspace, entry.path, { token: token ?? null }),
            refetchInterval: 5000,
        })),
    });
    const statuses = useMemo(() => new Map(props.root.entries.map((entry, i): [string, SourceStatus] => {
        const detail = results[i]?.data;
        return [entry.name, {
            rows: detail === undefined || detail.rows.type === "none" ? undefined : Number(detail.rows.value),
            hash: detail === undefined || detail.hash.type === "none" ? undefined : detail.hash.value,
        }];
    })), [props.root, results]);
    return <DatasetsLibrary {...props} statuses={statuses} />;
}

/** The tab's library, over the data sources' statuses. */
function DatasetsLibrary({ root, reads, onStart, id, words, storageKey, statuses }: DatasetsTabProps & { statuses: ReadonlyMap<string, SourceStatus> }) {
    const m = words.messages;
    const value = useMemo((): LibraryValue => {
        const items = root.entries.map((entry) => {
            const type = fromEastTypeValue(entry.type);
            const { kind, icon } = sourceKind(type);
            const status = statuses.get(entry.name);
            const size = sourceSize(entry.name, type, status?.rows, words);
            const hash = status?.hash?.slice(0, HASH_CHARS);
            const meta = size === "" && hash === undefined ? undefined : m.sourceMeta({ size, hash });
            const role = reads.get(entry.name);
            const item: LibraryItemValue = {
                key: entry.name,
                label: entry.name,
                sublabel: meta === undefined ? none : some(meta),
                icon: some(icon),
                status: none,
                // A placed card draws its glyph in the brand ink.
                trailing: role === undefined ? none : some({ icon: role === "source" ? "play" : "arrow-right-arrow-left", label: m.sourceRole({ role }), tone: none }),
                draggable: false,
                filtered: false,
                placed: role !== undefined,
                media: none,
                avatar: none,
                byline: none,
                action: none,
                search: some(entry.name),
                groups: new Map([["kind", m.datasetGroup({ kind })]]),
                facets: new Map(),
                dims: new Map(),
            };
            return { kind, item };
        });
        // The groups in their order; each group's sources in the order the builder is handed them.
        const ordered = KIND_ORDER.flatMap((kind) => items.filter((i) => i.kind === kind).map((i) => i.item));
        return {
            id,
            hint: none,
            items: ordered,
            groupOptions: [{ key: "kind", label: m.tab({ tab: "datasets" }) }],
            groupSummaries: new Map(),
            dimOptions: [],
            defaultDimensions: [],
            filterOptions: [],
            searchable: true,
            noun: some({ singular: m.dataSourceNoun({ n: 1 }), plural: m.dataSourceNoun({ n: 2 }) }),
            addLabel: none,
            onAdd: none,
            onCardClick: some((key: string) => { onStart(key); return null; }),
            slice: none,
            style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
            variant: none,
            layout: none,
            toolbar: true,
        };
    }, [root, reads, onStart, id, words, m, statuses]);
    return <EastChakraLibrary value={value} storageKey={storageKey} />;
}

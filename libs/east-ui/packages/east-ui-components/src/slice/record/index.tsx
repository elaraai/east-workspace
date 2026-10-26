/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record narrowing controls on the existing Slice popover and toolbar ladder. */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Skeleton, useSlotRecipe } from "@chakra-ui/react";
import { faCalendar, faFilter, faMagnifyingGlass, faUsers } from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix, IconProp } from "@fortawesome/fontawesome-svg-core";
import { DateTimeType, IntegerType, FloatType, lessFor, parseFor, printFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { recordChoiceWhere, type RecordSliceBindType, type RecordSliceFieldType, type RecordSliceChoiceType, type RecordSlicesBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { SliceSearchInput } from "../search/input.js";
import { SliceChoiceGroup, SliceCountSummary, SliceFieldActions, SliceFieldChip } from "../choice.js";
import { SliceRangeEditor, type SliceRangeKind } from "../range/editor.js";
import { ResolutionSeg, type ResolutionTag } from "../range/index.js";
import { useFormatters, type Formatters } from "../../format/index.js";
import { narrowedCount } from "../../collections/library/count.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { enableRecordSlicePersistence } from "../../platform/slice/record.js";
import type { SlicePersistMode } from "../../platform/slice/index.js";
import { SliceEditPopover } from "../edit/index.js";
import { useSliceRailItems, type SliceRailDescriptor } from "../rail/toolbar.js";
import { SUMMARY_RANK } from "../rail/ranks.js";
import { useSliceReactivity, useSlicesReactivity } from "../use-slice-reactivity.js";
import { useSliceDensity } from "../density.js";
import { PRESETS, presetAnchor, presetWindow } from "../range/presets.js";
import { printRecordChoice, readRecordChoice, recordChoiceLabel, recordValueLabel } from "./value.js";

type Bind = ValueTypeOf<RecordSliceBindType>;
type Product = ValueTypeOf<RecordSlicesBindType>;
type Part = Product["parts"][number];
type Field = ValueTypeOf<RecordSliceFieldType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
const scalarTypes = { datetime: DateTimeType, integer: IntegerType, float: FloatType };
/** How long a record search waits after the last keystroke before it reads: the rail's field search, and a paged tab's own (#1340). */
export const SEARCH_DELAY_MS = 250;

/** Optional Unset is not a String hint; only real known values replace search. */
function hasStringHints(field: Field): boolean {
    return field.kind === "string" && field.values.some(value => readRecordChoice(field, value.value) !== undefined);
}

/** A failed indexed read keeps its control mounted and offers a real retry. */
export function RecordSliceFailure({ slice, message = "Could not load choices" }: { slice: Bind; message?: string }) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    return <Box css={styles.hintRow} role="alert"><Box as="span" css={styles.hintError}>{message}</Box>
        <Button size="xs" variant="ghost" onClick={() => slice.retry()}>Retry</Button></Box>;
}

/** Exact counts use the same tracked reads as the data. Pending is never zero. */
export function RecordSliceSummary({ slice, noun = "rows" }: { slice: Bind; noun?: string }) {
    const read = useCallback(() => ({ count: slice.count(), total: slice.total() }), [slice]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) return <RecordSliceFailure slice={slice} message="Could not load count" />;
    const { count, total } = result.value;
    return <SliceCountSummary count={count.type === "some" ? count.value : undefined}
        total={total.type === "some" ? total.value : undefined} noun={noun} />;
}

/** A source's icon on the rail (#1339): its Icon definition's, drawn from the registered solid set. */
function sourceIcon(part: Part): IconProp | undefined {
    return part.icon.type === "some" ? [part.icon.value.prefix as IconPrefix, part.icon.value.name as IconName] : undefined;
}

/** How the rail heads a source's fields (#1339): its label, else the host's noun for it, else its name. */
function sourceHeading(part: Part, nouns: Readonly<Record<string, string>> | undefined): string {
    return part.label.type === "some" ? part.label.value : nouns?.[part.source] ?? part.source;
}

/**
 * The noun a source is counted in: the host's, else its label as running text
 * writes it — in lower case unless it is written in capitals (`SKU`) — else
 * its name. The rail's summary counts in it, and a builder's footer says what
 * it reads of the source in it (#1398: `Loading work orders 8,301–8,500`).
 *
 * @param part - The source's part of the slice
 * @param nouns - The host's noun for each source, by its name
 * @param locale - The locale the label is written in
 * @returns The noun
 */
export function recordSliceNoun(part: Part, nouns: Readonly<Record<string, string>> | undefined, locale: string): string {
    const noun = nouns?.[part.source];
    if (noun !== undefined) return noun;
    if (part.label.type === "none") return part.source;
    const label = part.label.value;
    return label === label.toLocaleUpperCase(locale) ? label : label.toLocaleLowerCase(locale);
}

/** Whether a narrowed count is under its record's total: what a narrowing hides rows of. */
const lessCount = lessFor(IntegerType);

/**
 * One source's exact counts as a summary reads them — each `none` while it is
 * read — and whether a narrowing is in force over it; or that they could not
 * be read.
 */
type SourceCounts = { ok: true; count: option<bigint>; total: option<bigint>; narrowed: boolean } | { ok: false };

/**
 * The sources a narrowing hides rows of, counted on one line (#1358):
 * `2 of 30 print job events · 6 of 16 customers`, each exact; nothing while
 * none does. A source a narrowing is in force over keeps its place while its
 * count is read — a new period's, a new choice's — the count pending, never a
 * zero, so the toolbar holds its slots and never folds again as the count
 * lands (#1398, CL1); once counted, it stays only if the narrowing hides rows
 * of it. One that could not be read says so, with its source's Retry.
 *
 * @param slices - The product's handle
 * @param nouns - The host's noun counting each source, by its name
 * @param except - Sources counted elsewhere — each in its heading in the rail's editor — and so not on this line
 */
export function RecordSlicesSummary({ slices, nouns, except }: {
    slices: Product; nouns?: Readonly<Record<string, string>> | undefined; except?: readonly string[] | undefined;
}) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const { locale } = useFormatters();
    // Where it is drawn: in the Filters editor its line wraps within the panel; in the toolbar it is one line, whole.
    const density = useSliceDensity();
    // The sources it counts, kept while the product and the sources skipped are the same: `except` is keyed by its names.
    const skipped = except?.join("\u0000") ?? "";
    const parts = useMemo(() => {
        const skip = new Set(skipped === "" ? [] : skipped.split("\u0000"));
        return slices.parts.filter(part => !skip.has(part.source));
    }, [slices.parts, skipped]);
    // Each source read on its own: one failing leaves the others counted.
    const read = useCallback(() => parts.map((part): SourceCounts => {
        try { return { ok: true, count: part.slice.count(), total: part.slice.total(), narrowed: part.slice.read().where.size > 0 }; } catch { return { ok: false }; }
    }), [parts]);
    const { result } = useTrackedEvaluation(read);
    const named: ({ part: Part; failed: true } | { part: Part; failed: false; count: bigint | undefined; total: bigint | undefined })[] = [];
    if (result.ok) {
        parts.forEach((part, i) => {
            const counts = result.value[i]!;
            if (!counts.ok) named.push({ part, failed: true });
            else if (counts.count.type === "some" && counts.total.type === "some") {
                if (lessCount(counts.count.value, counts.total.value)) named.push({ part, failed: false, count: counts.count.value, total: counts.total.value });
            } else if (counts.narrowed) {
                named.push({ part, failed: false, count: counts.count.type === "some" ? counts.count.value : undefined, total: counts.total.type === "some" ? counts.total.value : undefined });
            }
        });
    }
    if (named.length === 0) return null;
    return <Box as="span" css={styles.choiceCounts} data-record-slices-summary="" data-density={density}>
        {named.map((shown, i) => <Fragment key={shown.part.source}>
            {i > 0 && <Box as="span" css={styles.choiceCountsGap} aria-hidden="true">·</Box>}
            <span data-record-slice-source={shown.part.source}>{shown.failed
                ? <RecordSliceFailure slice={shown.part.slice} message="Could not load count" />
                : <SliceCountSummary count={shown.count} total={shown.total} noun={recordSliceNoun(shown.part, nouns, locale)} />}</span>
        </Fragment>)}
    </Box>;
}

/**
 * A source's count at its heading in the rail's editor (#1358), as a Library
 * tab counts it: the total while nothing narrows the source, `2 of 30` while
 * its narrowing is in force; a skeleton while a count it needs is read, and
 * its source's Retry when one could not be.
 */
function RecordSourceCount({ slice }: { slice: Bind }) {
    useSliceReactivity(slice.key);
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const words = useFormatters();
    const read = useCallback(() => ({ count: slice.count(), total: slice.total() }), [slice]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) return <RecordSliceFailure slice={slice} message="Could not load count" />;
    const narrowing = slice.read().where.size > 0;
    const { count, total } = result.value;
    const shown = narrowing ? count : total;
    if (total.type === "none" || shown.type === "none") {
        return <Box as="span" role="status" aria-busy="true"><Skeleton as="span" css={styles.choicePending} aria-label="Count loading" /></Box>;
    }
    const said = narrowedCount(words, Number(shown.value), Number(total.value), narrowing);
    return <Box as="span" role="status" aria-busy="false">{typeof said === "number" ? words.number(said) : said}</Box>;
}

function proposalFor(slice: Bind, field: Field, choice: Choice, words: ReturnType<typeof useFormatters>): { hint?: string; disabled: boolean } {
    const state = slice.read();
    const next = recordChoiceWhere(slice.config.indexes, state.where, field.fieldId, choice);
    if (next === null) return { hint: "Choose a preceding field first.", disabled: true };
    const replaced = slice.config.fields.filter(f => state.where.has(f.fieldId) && !next.has(f.fieldId));
    return { disabled: false, ...(replaced.length === 0 ? {} : { hint: `Replaces ${replaced.map(f => recordChoiceLabel(f, state.where.get(f.fieldId), words)).join("; ")}` }) };
}

function KnownValues({ slice, field, run }: { slice: Bind; field: Field; run: (action: () => unknown) => void }) {
    const words = useFormatters();
    const read = useCallback(() => slice.values(field.fieldId), [slice, field.fieldId]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) return <RecordSliceFailure slice={slice} />;
    const nextValues = (value: string) => {
        const current = slice.read().where.get(field.fieldId);
        const chosen = current?.type === "values" ? current.value : [];
        return chosen.includes(value) ? chosen.filter(v => v !== value) : field.multiple ? [...chosen, value] : [value];
    };
    return <SliceChoiceGroup choices={result.value.map(value => {
        const values = nextValues(value.value);
        const proposal = values.length === 0 ? { disabled: false } : proposalFor(slice, field, variant("values", values), words);
        return { id: value.value, label: recordValueLabel(field, value.value, words), active: value.selected,
            ...(!proposal.disabled ? { count: value.count.type === "some" ? value.count.value : null } : {}),
            ...(value.error.type === "some" && !proposal.disabled ? { error: `Could not count ${value.label}` } : {}),
            ...proposal };
    })} onPick={value => run(() => slice.choose(field.fieldId, nextValues(value)))} onRetry={() => slice.retry()} />;
}

function StringSearch({ slice, field, run }: { slice: Bind; field: Field; run: (action: () => unknown) => void }) {
    const choice = slice.read().where.get(field.fieldId);
    const external = choice?.type === "prefix" ? choice.value : choice?.type === "values" && choice.value[0] !== undefined
        ? readRecordChoice(field, choice.value[0]) as string | undefined ?? "" : "";
    const [text, setText] = useState(external);
    const [query, setQuery] = useState(external);
    useEffect(() => { setText(external); setQuery(external); }, [external]);
    useEffect(() => { const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [text]);
    const words = useFormatters();
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const blocked = proposalFor(slice, field, variant("values", [printRecordChoice(field, query)]), words).disabled;
    const read = useCallback(() => blocked ? some([]) : slice.suggest(field.fieldId, query), [slice, field.fieldId, query, blocked]);
    const { result } = useTrackedEvaluation(read);
    const pending = !blocked && (text !== query || (result.ok && result.value.type === "none"));
    const suggestions = !pending && result.ok && result.value.type === "some" ? result.value.value : [];
    const countFailed = suggestions.some(value => value.error.type === "some");
    const prefix = !field.set && text !== "" ? proposalFor(slice, field, variant("prefix", text), words) : undefined;
    const items = [
        ...suggestions.map(value => ({ value: `value:${value.value}`, label: value.label,
            meta: value.error.type === "some" ? "Count unavailable" : value.count.type === "some" ? words.number(value.count.value)
                : <Skeleton as="span" css={styles.choicePending} aria-label="Count loading" />,
            ...proposalFor(slice, field, variant("values", [value.value]), words) })),
        ...(prefix === undefined ? [] : [{ value: "prefix", label: `All starting with “${text}”`, ...prefix }]),
    ];
    const choose = (id: string) => run(() => {
        if (!items.some(item => item.value === id && !item.disabled)) return;
        if (id === "prefix") slice.prefix(field.fieldId, text);
        else if (id.startsWith("value:")) {
            const literal = id.slice(6);
            setText(readRecordChoice(field, literal) as string);
            slice.choose(field.fieldId, [literal]);
        }
    });
    return <>
        <SliceSearchInput text={text} placeholder={`Search ${field.label.toLocaleLowerCase(words.locale)}…`}
            busy={pending} emptyText={pending ? "Searching…" : blocked ? "Choose a preceding field first." : "No matching values"}
            items={items}
            onInput={next => { setText(next); if (next === "") queueMicrotask(() => run(() => slice.clear(field.fieldId))); }}
            onSelect={id => queueMicrotask(() => choose(id))}
            {...(prefix !== undefined && !prefix.disabled ? { onSubmit: () => queueMicrotask(() => choose("prefix")) } : {})} />
        {(prefix?.hint || blocked) && <Box css={styles.hint}>{prefix?.hint ?? "Choose a preceding field first."}</Box>}
        {!result.ok && <RecordSliceFailure slice={slice} />}
        {countFailed && <RecordSliceFailure slice={slice} message="Could not load suggestion counts" />}
    </>;
}

/** Boundary seeks anchor presets to this index path, never to loaded rows. */
function DatePresets({ slice, field, run, domain }: { slice: Bind; field: Field; run: (action: () => unknown) => void; domain: { min: number; max: number } | undefined }) {
    const words = useFormatters();
    const { anchor, clamped } = presetAnchor(domain);
    const current = slice.read().where.get(field.fieldId);
    const choices = PRESETS.map(p => {
        const window = presetWindow(p.tag, anchor, true);
        const valid = domain !== undefined && Number.isFinite(window.to.getTime());
        const choice = valid ? variant("range", { from: printRecordChoice(field, window.from), to: printRecordChoice(field, window.to) }) : undefined;
        return { id: p.tag, label: p.tag === "today" && clamped ? "Last day" : p.label,
            active: choice !== undefined && current?.type === "range" && current.value.from === choice.value.from && current.value.to === choice.value.to,
            ...(choice === undefined ? { disabled: true } : proposalFor(slice, field, choice, words)), choice };
    });
    return <SliceChoiceGroup choices={choices} onPick={id => run(() => {
        const chosen = choices.find(p => p.id === id);
        if (chosen?.choice !== undefined && !chosen.disabled) slice.range(field.fieldId, chosen.choice.value.from, chosen.choice.value.to);
    })} />;
}

function ScalarRange({ slice, field, choice, run }: { slice: Bind; field: Field; choice: Choice | undefined; run: (action: () => unknown) => void }) {
    const words = useFormatters();
    const kind = field.kind as SliceRangeKind;
    const bounds = useCallback(() => kind === "datetime" ? slice.domain(field.fieldId) : none, [slice, field.fieldId, kind]);
    const { result } = useTrackedEvaluation(bounds);
    const domain = result.ok && result.value.type === "some" ? {
        min: (readRecordChoice(field, result.value.value.from) as Date).getTime(),
        max: (readRecordChoice(field, result.value.value.to) as Date).getTime(),
    } : undefined;
    const start = presetAnchor(domain).anchor;
    start.setUTCHours(0, 0, 0, 0);
    const type = scalarTypes[kind];
    const read = parseFor(type); const print = printFor(type);
    const initial = choice?.type === "range" ? choice.value : { from: choice?.type === "values" ? choice.value[0] ?? "" : "", to: "" };
    const input = (text: string) => { const value = text === "" ? undefined : readRecordChoice(field, text); return value === undefined ? "" : print(value as ValueTypeOf<typeof type>); };
    const literal = (text: string) => { const parsed = read(text); if (!parsed.success) throw new Error(`Enter a valid ${field.label}`); return printRecordChoice(field, parsed.value); };
    return <SliceRangeEditor kind={kind} label={field.label} from={input(initial.from)} to={input(initial.to)} single={field.set} exclusive
        onClear={() => run(() => slice.clear(field.fieldId))} clearDisabled={choice === undefined}
        {...(kind === "datetime" ? { defaultFrom: printFor(DateTimeType)(start) } : {})}
        proposal={(from, to) => {
            if (!read(from).success || (!field.set && !read(to).success)) return undefined;
            return proposalFor(slice, field, field.set ? variant("values", [literal(from)]) : variant("range", { from: literal(from), to: literal(to) }), words);
        }}
        onApply={(from, to) => run(() => field.set ? slice.choose(field.fieldId, [literal(from)]) : slice.range(field.fieldId, literal(from), literal(to)))}>
        {kind === "datetime" && !result.ok && <RecordSliceFailure slice={slice} message="Could not load date span" />}
        {kind === "datetime" && !field.set && <DatePresets slice={slice} field={field} run={run} domain={domain} />}
    </SliceRangeEditor>;
}

/** The same typed field editor inside a host-owned navigator or the Slice rail. */
export function RecordSliceFieldEditor({ slice, field, source }: { slice: Bind; field: Field; source?: string | undefined }) {
    useSliceReactivity(slice.key);
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const [error, setError] = useState<string>();
    const state = slice.read();
    const choice = state.where.get(field.fieldId);
    const scalar = ["datetime", "integer", "float"].includes(field.kind);
    const run = (action: () => unknown) => {
        try { action(); setError(undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this choice"); }
    };
    return <Box css={styles.choiceList} data-record-slice-editor={field.fieldId} data-record-slice-source={source}>
            {field.set && <Box css={styles.hint}>Includes one value</Box>}
            {field.values.length > 0 && <KnownValues slice={slice} field={field} run={run} />}
            {field.kind === "string" && !hasStringHints(field) && slice.config.search.includes(field.fieldId) && <StringSearch slice={slice} field={field} run={run} />}
            {scalar && <ScalarRange slice={slice} field={field} choice={choice} run={run} />}
        {error !== undefined && <Box css={styles.hintError} role="alert">{error}</Box>}
        {!scalar && <SliceFieldActions label={field.label} onClear={() => run(() => slice.clear(field.fieldId))} clearDisabled={choice === undefined} />}
    </Box>;
}

function FieldChip({ slice, field, source }: { slice: Bind; field: Field; source?: string | undefined }) {
    useSliceReactivity(slice.key);
    const [open, setOpen] = useState(false);
    const words = useFormatters();
    const choice = slice.read().where.get(field.fieldId);
    const label = recordChoiceLabel(field, choice, words);
    return <SliceEditPopover open={open} onOpenChange={setOpen} label={field.label} trigger={
        <SliceFieldChip label={field.label} aria-label={label} active={choice !== undefined} caret data-record-slice-field={field.fieldId} data-record-slice-source={source} />
    }>{open && <RecordSliceFieldEditor slice={slice} field={field} source={source} />}</SliceEditPopover>;
}

function Presets({ slice }: { slice: Bind }) {
    useSliceReactivity(slice.key);
    const state = slice.read();
    return <SliceChoiceGroup choices={slice.config.presets.map(p => ({ id: p.id, label: p.name,
        active: state.preset.type === "some" && state.preset.value === p.id }))} onPick={id => slice.togglePreset(id)} />;
}

/** A record field's rail descriptor: its words, icon and fold rank, the same in every host. */
function fieldDescriptor(slice: Bind, field: Field, kind: string, words: Formatters, attributes?: Readonly<Record<string, string>>): SliceRailDescriptor {
    const choice = slice.read().where.get(field.fieldId);
    const range = !field.set && ["datetime", "integer", "float"].includes(field.kind);
    const search = field.kind === "string" && !hasStringHints(field) && slice.config.search.includes(field.fieldId);
    return { kind, label: field.label, icon: range ? faCalendar : search ? faMagnifyingGlass : faFilter,
        text: recordChoiceLabel(field, choice, words), active: choice !== undefined, rank: range ? 2 : search ? 1 : 3,
        ...(attributes === undefined ? {} : { attributes }) };
}

/** The fields a record Slice offers under the host's affordances. */
function offeredFields(slice: Bind, affordances: readonly string[], exclude?: readonly string[]): Field[] {
    return slice.config.fields.filter(field => !exclude?.includes(field.fieldId)).filter(field => affordances.includes("fields")
        || (affordances.includes("search") && slice.config.search.includes(field.fieldId))
        || (affordances.includes("range") && slice.config.range.type === "some" && slice.config.range.value === field.fieldId));
}

/** A list of words as one key: what a host's new array of the same words keeps a memo by. */
function wordsKey(list: readonly string[] | undefined): string {
    return list === undefined ? "" : list.join("\u0000");
}

/** A host's nouns, by source, as one key, in source order. */
function nounsKey(nouns: Readonly<Record<string, string>> | undefined): string {
    return nouns === undefined ? "" : Object.keys(nouns).sort().map(source => `${source}\u0001${nouns[source]}`).join("\u0000");
}

/**
 * Shared toolbar items used by every host of a record Slice. They are made
 * again only as the slice's state, its words or the host's options move
 * (#1398, CL9): a host drawn again with nothing of its rail moved hands its
 * toolbar the same items.
 */
export function useRecordSliceToolbarItems(slice: Bind | undefined, options: { persist?: SlicePersistMode; noun?: string; affordances?: readonly string[]; excludeFields?: readonly string[]; resolutions?: readonly ResolutionTag[] } = {}): ToolbarItem[] {
    const version = useSliceReactivity(slice?.key);
    const words = useFormatters();
    const persist = options.persist;
    useEffect(() => { if (slice !== undefined && persist !== undefined) enableRecordSlicePersistence(slice, persist); }, [slice, persist]);
    const noun = options.noun;
    const affordancesAt = wordsKey(options.affordances);
    const excludeAt = wordsKey(options.excludeFields);
    const resolutionsAt = wordsKey(options.resolutions);
    // What the rail is drawn from, made again as the slice's state moves (its version) or the host's options do.
    const made = useMemo(() => {
        const state = slice?.read();
        const affordances = options.affordances ?? ["fields", "presets", "summary"];
        const fields = slice === undefined ? [] : offeredFields(slice, affordances, options.excludeFields);
        const presets = affordances.includes("presets") && (slice?.config.presets.length ?? 0) > 0;
        const resolution = affordances.includes("resolution") && slice?.config.range.type === "some"
            && slice.config.fields.some(field => field.fieldId === slice.config.range.value && field.kind === "datetime" && !field.set);
        const resolutions = options.resolutions ?? ["auto", "hour", "day", "week", "month", "quarter", "year"];
        const byKind = new Map(fields.map(field => [`field:${field.fieldId}`, field]));
        const kinds = [...byKind.keys(), ...(presets ? ["presets"] : []), ...(resolution && resolutions.length > 0 ? ["resolution"] : [])];
        const summary = slice !== undefined && affordances.includes("summary") ? <RecordSliceSummary slice={slice} {...(noun === undefined ? {} : { noun })} /> : undefined;
        const model = slice === undefined || state === undefined ? undefined : {
            // The rail's own choices: each field it offers that holds one — never a field it leaves out, a window among them.
            version, activeCount: fields.filter(field => state.where.has(field.fieldId)).length, clear: () => { slice.clearAll(); },
            status: summary,
            describe: (kind: string): SliceRailDescriptor => {
                if (kind === "resolution") return { kind, label: "Resolution", icon: faCalendar, text: state.resolution.type === "some" ? `Resolution: ${state.resolution.value.type}` : "Auto", active: state.resolution.type === "some", rank: 2 };
                const field = byKind.get(kind);
                if (field === undefined) {
                    const selected = state.preset.type === "some" ? slice.config.presets.find(p => p.id === state.preset.value) : undefined;
                    return { kind, label: "Presets", icon: faUsers, text: selected === undefined ? "Presets" : `Presets: ${selected.name}`, active: selected !== undefined, rank: 3 };
                }
                return fieldDescriptor(slice, field, kind, words);
            },
            renderEditor: (kind: string) => {
                if (kind === "resolution") return <ResolutionSeg options={resolutions} active={state.resolution.type === "some" ? state.resolution.value.type : undefined}
                    onPick={tag => slice.setResolution(some(variant(tag, null)))} />;
                const field = byKind.get(kind);
                return field === undefined ? <Presets slice={slice} /> : <RecordSliceFieldEditor slice={slice} field={field} />;
            },
            render: (kind: string) => {
                if (kind === "resolution") return <ResolutionSeg options={resolutions} active={state.resolution.type === "some" ? state.resolution.value.type : undefined}
                    onPick={tag => slice.setResolution(some(variant(tag, null)))} />;
                const field = byKind.get(kind);
                return field === undefined ? <Presets slice={slice} /> : <FieldChip slice={slice} field={field} />;
            },
        };
        return { model, clusters: [{ key: "record-slice", kinds }], summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slice's state is its version; the options are read by what they hold
    }, [slice, version, words, noun, affordancesAt, excludeAt, resolutionsAt]);
    const items = useSliceRailItems(made.model, made.clusters);
    // The summary folds after every step of the rail, whose editor keeps it, and before the host's own items.
    return useMemo(() => (made.summary === undefined ? items
        : [...items, { key: "record-summary", side: "end" as const, rank: SUMMARY_RANK, forms: [made.summary, null] }]), [items, made.summary]);
}

/** A preset over several records: selected when every part holds it; a pick is the product's own toggle. */
function ProductPresets({ slices }: { slices: Product }) {
    useSlicesReactivity(slices.parts.map(part => part.slice.key));
    return <SliceChoiceGroup choices={slices.presets.map(p => ({ id: p.id, label: p.name, active: productPreset(slices) === p.id }))}
        onPick={id => slices.togglePreset(id)} />;
}

/** The preset every part holds, if one does. */
function productPreset(slices: Product): string | undefined {
    const [first, ...rest] = slices.parts.map(part => part.slice.read().preset);
    return first?.type === "some" && rest.every(preset => preset.type === "some" && preset.value === first.value) ? first.value : undefined;
}

/**
 * Toolbar items for a narrowing over several records (`Slice.bindRecords`):
 * one rail, each source's field chips in source order, the presets over
 * them, one Clear all, and one summary naming the sources a narrowing hides
 * rows of (#1358). A source's icon marks its fields' chips; folded, with
 * fields from more than one source, the editor heads each source's fields
 * with its name, its icon and its count — the total, or `N of M` while
 * narrowed — then the presets with `Presets` (#1339, #1358); a line under the
 * fields names what no heading counts that a narrowing hides rows of.
 *
 * @param slices - The product's handle; undefined mounts nothing
 * @param options - Persistence for every part, the noun counting and, without a label of its own, heading each source (by its name), the affordances, and fields to leave out (as `source.field`)
 * @returns Items for the host's one Toolbar
 */
export function useRecordSlicesToolbarItems(slices: Product | undefined, options: {
    persist?: SlicePersistMode; nouns?: Readonly<Record<string, string>>; affordances?: readonly string[]; excludeFields?: readonly string[];
} = {}): ToolbarItem[] {
    const version = useSlicesReactivity(slices?.parts.map(part => part.slice.key) ?? []);
    const words = useFormatters();
    const persist = options.persist;
    useEffect(() => {
        if (slices === undefined || persist === undefined) return;
        for (const part of slices.parts) enableRecordSlicePersistence(part.slice, persist);
    }, [slices, persist]);
    const nounsAt = nounsKey(options.nouns);
    const affordancesAt = wordsKey(options.affordances);
    const excludeAt = wordsKey(options.excludeFields);
    // What the rail is drawn from, made again as a source's state moves (the version) or the host's options do (#1398,
    // CL9): a host drawn again at each window landing hands its toolbar the same items.
    const made = useMemo(() => {
        const nouns = options.nouns;
        const affordances = options.affordances ?? ["fields", "presets", "summary"];
        const entries = slices?.parts.flatMap(part => offeredFields(part.slice, affordances,
            options.excludeFields?.filter(name => name.startsWith(`${part.source}.`)).map(name => name.slice(part.source.length + 1)))
            .map(field => ({ kind: `field:${part.source}.${field.fieldId}`, part, field }))) ?? [];
        const byKind = new Map(entries.map(entry => [entry.kind, entry]));
        const presets = affordances.includes("presets") && (slices?.presets.length ?? 0) > 0;
        const kinds = [...byKind.keys(), ...(presets ? ["presets"] : [])];
        // Fields from more than one source are headed by their source; the presets, over them all, by their own.
        const headings = [...new Set(entries.map(entry => entry.part.source))];
        const headed = headings.length > 1;
        // Counted as the summary affordance asks (#1358): in the editor, each headed source in its heading, and what no
        // heading counts on a line under the fields; on the toolbar, every source a narrowing hides rows of.
        const counted = slices !== undefined && affordances.includes("summary");
        const summary = counted ? <RecordSlicesSummary slices={slices} nouns={nouns} /> : undefined;
        const status = counted ? <RecordSlicesSummary slices={slices} nouns={nouns} except={headed ? headings : []} /> : undefined;
        const model = slices === undefined ? undefined : {
            // The rail's own choices: each field it lists that holds one — never a source's window, which the host's
            // navigation writes and the rail leaves out (`excludeFields`), nor any other field it does not offer.
            version, activeCount: entries.filter(entry => entry.part.slice.read().where.has(entry.field.fieldId)).length,
            clear: () => { slices.clearAll(); },
            status,
            describe: (kind: string): SliceRailDescriptor => {
                const entry = byKind.get(kind);
                if (entry === undefined) {
                    const id = productPreset(slices);
                    const selected = id === undefined ? undefined : slices.presets.find(p => p.id === id);
                    return { kind, label: "Presets", icon: faUsers, text: selected === undefined ? "Presets" : `Presets: ${selected.name}`, active: selected !== undefined, rank: 3,
                        ...(headed ? { group: { key: "presets", label: "Presets" } } : {}) };
                }
                const field = fieldDescriptor(entry.part.slice, entry.field, kind, words,
                    { "data-record-slice-source": entry.part.source, "data-record-slice-field": entry.field.fieldId });
                const icon = sourceIcon(entry.part);
                return { ...field, ...(icon === undefined ? {} : { icon }),
                    ...(headed ? { group: { key: `source:${entry.part.source}`, label: sourceHeading(entry.part, nouns), icon,
                        ...(counted ? { count: <RecordSourceCount slice={entry.part.slice} /> } : {}) } } : {}) };
            },
            renderEditor: (kind: string) => {
                const entry = byKind.get(kind);
                return entry === undefined ? <ProductPresets slices={slices} /> : <RecordSliceFieldEditor slice={entry.part.slice} field={entry.field} source={entry.part.source} />;
            },
            render: (kind: string) => {
                const entry = byKind.get(kind);
                return entry === undefined ? <ProductPresets slices={slices} /> : <FieldChip slice={entry.part.slice} field={entry.field} source={entry.part.source} />;
            },
        };
        return { model, clusters: [{ key: "record-slices", kinds }], summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sources' state is the version; the options are read by what they hold
    }, [slices, version, words, nounsAt, affordancesAt, excludeAt]);
    const items = useSliceRailItems(made.model, made.clusters);
    // As one record's: after every step of the rail, before the host's own items.
    return useMemo(() => (made.summary === undefined ? items
        : [...items, { key: "record-summary", side: "end" as const, rank: SUMMARY_RANK, forms: [made.summary, null] }]), [items, made.summary]);
}

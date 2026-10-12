/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record narrowing controls on the existing Slice popover and toolbar ladder. */
import { useCallback, useEffect, useState } from "react";
import { Box, Button, Skeleton, useSlotRecipe } from "@chakra-ui/react";
import { faCalendar, faFilter, faMagnifyingGlass, faUsers } from "@fortawesome/free-solid-svg-icons";
import { DateTimeType, IntegerType, FloatType, parseFor, printFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { recordChoiceWhere, type RecordSliceBindType, type RecordSliceFieldType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { SliceSearchInput } from "../search/input.js";
import { SliceChoiceGroup, SliceCountSummary, SliceFieldActions, SliceFieldChip } from "../choice.js";
import { SliceRangeEditor, type SliceRangeKind } from "../range/editor.js";
import { ResolutionSeg, type ResolutionTag } from "../range/index.js";
import { useFormatters } from "../../format/index.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { enableRecordSlicePersistence } from "../../platform/slice/record.js";
import type { SlicePersistMode } from "../../platform/slice/index.js";
import { SliceEditPopover } from "../edit/index.js";
import { useSliceRailItems } from "../rail/toolbar.js";
import { useSliceReactivity } from "../use-slice-reactivity.js";
import { PRESETS, presetAnchor, presetWindow } from "../range/presets.js";
import { printRecordChoice, readRecordChoice, recordChoiceLabel, recordValueLabel } from "./value.js";

type Bind = ValueTypeOf<RecordSliceBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
const scalarTypes = { datetime: DateTimeType, integer: IntegerType, float: FloatType };
const SEARCH_DELAY_MS = 250;

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
export function RecordSliceFieldEditor({ slice, field }: { slice: Bind; field: Field }) {
    useSliceReactivity(slice.key);
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const [error, setError] = useState<string>();
    const state = slice.read();
    const choice = state.where.get(field.fieldId);
    const scalar = ["datetime", "integer", "float"].includes(field.kind);
    const run = (action: () => unknown) => {
        try { action(); setError(undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this choice"); }
    };
    return <Box css={styles.choiceList} data-record-slice-editor={field.fieldId}>
            {field.set && <Box css={styles.hint}>Includes one value</Box>}
            {field.values.length > 0 && <KnownValues slice={slice} field={field} run={run} />}
            {field.kind === "string" && !hasStringHints(field) && slice.config.search.includes(field.fieldId) && <StringSearch slice={slice} field={field} run={run} />}
            {scalar && <ScalarRange slice={slice} field={field} choice={choice} run={run} />}
        {error !== undefined && <Box css={styles.hintError} role="alert">{error}</Box>}
        {!scalar && <SliceFieldActions label={field.label} onClear={() => run(() => slice.clear(field.fieldId))} clearDisabled={choice === undefined} />}
    </Box>;
}

function FieldChip({ slice, field }: { slice: Bind; field: Field }) {
    useSliceReactivity(slice.key);
    const [open, setOpen] = useState(false);
    const words = useFormatters();
    const choice = slice.read().where.get(field.fieldId);
    const label = recordChoiceLabel(field, choice, words);
    return <SliceEditPopover open={open} onOpenChange={setOpen} label={field.label} trigger={
        <SliceFieldChip label={field.label} aria-label={label} active={choice !== undefined} caret data-record-slice-field={field.fieldId} />
    }>{open && <RecordSliceFieldEditor slice={slice} field={field} />}</SliceEditPopover>;
}

function Presets({ slice }: { slice: Bind }) {
    useSliceReactivity(slice.key);
    const state = slice.read();
    return <SliceChoiceGroup choices={slice.config.presets.map(p => ({ id: p.id, label: p.name,
        active: state.preset.type === "some" && state.preset.value === p.id }))} onPick={id => slice.togglePreset(id)} />;
}

/** Shared toolbar items used by every host of a record Slice. */
export function useRecordSliceToolbarItems(slice: Bind | undefined, options: { persist?: SlicePersistMode; noun?: string; affordances?: readonly string[]; excludeFields?: readonly string[]; resolutions?: readonly ResolutionTag[] } = {}): ToolbarItem[] {
    const version = useSliceReactivity(slice?.key);
    const words = useFormatters();
    const persist = options.persist;
    useEffect(() => { if (slice !== undefined && persist !== undefined) enableRecordSlicePersistence(slice, persist); }, [slice, persist]);
    const state = slice?.read();
    const affordances = options.affordances ?? ["fields", "presets", "summary"];
    const fields = slice?.config.fields.filter(field => !options.excludeFields?.includes(field.fieldId)).filter(field => affordances.includes("fields")
        || (affordances.includes("search") && slice.config.search.includes(field.fieldId))
        || (affordances.includes("range") && slice.config.range.type === "some" && slice.config.range.value === field.fieldId)) ?? [];
    const presets = affordances.includes("presets") && (slice?.config.presets.length ?? 0) > 0;
    const resolution = affordances.includes("resolution") && slice?.config.range.type === "some"
        && slice.config.fields.some(field => field.fieldId === slice.config.range.value && field.kind === "datetime" && !field.set);
    const resolutions = options.resolutions ?? ["auto", "hour", "day", "week", "month", "quarter", "year"];
    const byKind = new Map(fields.map(field => [`field:${field.fieldId}`, field]));
    const kinds = [...byKind.keys(), ...(presets ? ["presets"] : []), ...(resolution && resolutions.length > 0 ? ["resolution"] : [])];
    const items = useSliceRailItems(slice === undefined || state === undefined ? undefined : {
        version, activeCount: state.where.size, clear: () => { slice.clearAll(); },
        status: affordances.includes("summary") ? <RecordSliceSummary slice={slice} {...(options.noun === undefined ? {} : { noun: options.noun })} /> : undefined,
        describe: kind => {
            if (kind === "resolution") return { kind, label: "Resolution", icon: faCalendar, text: state.resolution.type === "some" ? `Resolution: ${state.resolution.value.type}` : "Auto", active: state.resolution.type === "some", rank: 2 };
            const field = byKind.get(kind);
            if (field === undefined) {
                const selected = state.preset.type === "some" ? slice.config.presets.find(p => p.id === state.preset.value) : undefined;
                return { kind, label: "Presets", icon: faUsers, text: selected === undefined ? "Presets" : `Presets: ${selected.name}`, active: selected !== undefined, rank: 3 };
            }
            const choice = state.where.get(field.fieldId);
            const range = !field.set && ["datetime", "integer", "float"].includes(field.kind);
            const search = field.kind === "string" && !hasStringHints(field) && slice.config.search.includes(field.fieldId);
            return { kind, label: field.label, icon: range ? faCalendar : search ? faMagnifyingGlass : faFilter,
                text: recordChoiceLabel(field, choice, words), active: choice !== undefined, rank: range ? 2 : search ? 1 : 3 };
        },
        renderEditor: kind => {
            if (kind === "resolution") return <ResolutionSeg options={resolutions} active={state.resolution.type === "some" ? state.resolution.value.type : undefined}
                onPick={tag => slice.setResolution(some(variant(tag, null)))} />;
            const field = byKind.get(kind);
            return field === undefined ? <Presets slice={slice} /> : <RecordSliceFieldEditor slice={slice} field={field} />;
        },
        render: kind => {
            if (kind === "resolution") return <ResolutionSeg options={resolutions} active={state.resolution.type === "some" ? state.resolution.value.type : undefined}
                onPick={tag => slice.setResolution(some(variant(tag, null)))} />;
            const field = byKind.get(kind);
            return field === undefined ? <Presets slice={slice} /> : <FieldChip slice={slice} field={field} />;
        },
    }, [{ key: "record-slice", kinds }]);
    if (slice !== undefined && affordances.includes("summary")) items.push({ key: "record-summary", side: "end", rank: 12, forms: [
        <RecordSliceSummary slice={slice} {...(options.noun === undefined ? {} : { noun: options.noun })} />, null,
    ] });
    return items;
}

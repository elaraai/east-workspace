/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the query builder's model says (#934) — ONE typed message table:
 * the steps' titles, verbs and add-step entries; the comparisons; kinds,
 * shapes and counts; the parts of a step card; the autocomplete's labels,
 * groups and offers; a summary's words; the plain sentence for each problem
 * and fix (`Query Editor Spec.md` §4.6); and the generated description
 * (§4.13). What the AUTHOR wrote, and what the data holds — a field's name, a
 * case, a value, a saved query's name — is data, and never passes through it.
 *
 * English is the default. The model's functions take the table as a
 * parameter, so a renderer passes its own; numbers arrive already formatted
 * for the locale, and `n` is the raw count, for plurals.
 *
 * @packageDocumentation
 */

import type { ComparisonKind, StepKind } from "../steps/values.js";

/** What a slot asks for: each kind of slot a step card has. */
export type SlotKind =
    | "match" | "group-match"
    | "field" | "cmp" | "value"
    | "key" | "dataset" | "lookup-add"
    | "by" | "agg-fn" | "agg-field"
    | "sort-field" | "dir"
    | "pick-field" | "pick-add"
    | "fill-field" | "drill-field" | "via"
    | "part" | "date-field"
    | "fixed"
    | "add-step";

/** A kind of value, in plain words. */
export type KindName =
    | "text" | "wholeNumber" | "number" | "date" | "yesNo" | "nothing" | "bytes"
    | "oneOf" | "list" | "lookupTable" | "calculation" | "record" | "tree" | "value";

/** A total's function. */
export type TotalName = "count" | "sum" | "mean" | "min" | "max" | "distinct";

/** What one value is, for the shape of a query that gives one. */
export type OneKind = "wholeNumber" | "number" | "text" | "record" | "tree" | "calculation" | "list" | "lookupTable" | "value";

/** The query builder's message table. */
export interface QueryMessages {
    // ── Steps ────────────────────────────────────────────────────────────
    /** A step card's title — `Open each order's list` names the rows. */
    stepTitle: (p: { kind: StepKind; noun: string }) => string;
    /** What a step does to rows, for "there are no rows to {verb} here". */
    stepVerb: (p: { kind: StepKind }) => string;
    /** A step in the add-step list. */
    addStepLabel: (p: { kind: StepKind; noun: string }) => string;
    /** Under it. */
    addStepHint: (p: { kind: StepKind }) => string;
    /** The words the add-step list's filter matches, besides the label. */
    addStepKeywords: (p: { kind: StepKind }) => string;
    /** A step's Quick add button. */
    quickAddLabel: (p: { kind: StepKind }) => string;
    /** Why List every part does not fit here. */
    needsTree: () => string;
    /** Why Try the model does not fit here. */
    needsCalculation: () => string;
    /** Why a step that takes a kind of field the rows lack does not fit. */
    nothingToUse: () => string;
    /** Why a step that takes rows does not fit — `Needs rows — the query gives one whole number here`. */
    needsRows: (p: { shape: string }) => string;
    /** Under an unfinished step. */
    notFinished: () => string;
    /** The Query tab with no steps. */
    noSteps: () => string;
    /** The foot's dashed add. */
    addStepAtEnd: () => string;
    /** Before the Quick add buttons. */
    quickAdd: () => string;
    /** A shape line's add. */
    insert: () => string;
    /** The source's title — `Start with orders`. */
    startWith: (p: { source: string }) => string;

    // ── Comparisons ──────────────────────────────────────────────────────
    /** A comparison — `is at least`. */
    comparison: (p: { cmp: ComparisonKind }) => string;
    /** Beside a comparison in the list, when it needs saying. */
    comparisonDetail: (p: { cmp: ComparisonKind }) => string;

    // ── Kinds, shapes and counts ─────────────────────────────────────────
    /** A kind of value — `list of lines`, `one of cancelled, pending, shipped`. */
    kind: (p: { kind: KindName; items?: string; cases?: string }) => string;
    /** A kind that can be missing — `number, sometimes missing`. */
    sometimesMissing: (p: { kind: string }) => string;
    /** Rows, not counted — `Many shipped orders`. */
    shapeMany: (p: { rows: string }) => string;
    /** Rows a Keep the first bounds — `Up to 10 shipped orders`. */
    shapeUpTo: (p: { count: string; rows: string }) => string;
    /** One value — `One whole number`, `One bom tree`. */
    shapeOne: (p: { kind: OneKind; noun: string }) => string;
    /** A shape the checker could not tell, after a problem. */
    shapeUnknown: () => string;
    /** Rows counted — `16 shipped orders`. */
    countRows: (p: { count: string; rows: string }) => string;
    /** Rows described: an adjective and a noun, already in the right number — `shipped orders`. */
    rows: (p: { adjective: string; noun: string }) => string;
    /** The fields a step added — `+ name, region`. */
    fieldsAdded: (p: { fields: string }) => string;
    /** The status line's shape — `Gives 10 orders`. */
    gives: (p: { shape: string }) => string;

    // ── A step card's parts ──────────────────────────────────────────────
    /** A match. */
    match: (p: { match: "all" | "any" }) => string;
    /** After it — `of these are true`. */
    ofThese: (p: { match: "all" | "any" }) => string;
    /** A joiner between conditions. */
    joiner: (p: { match: "all" | "any" }) => string;
    /** Look up: before its key. */
    find: () => string;
    /** Look up: before its dataset. */
    inDataset: () => string;
    /** Look up: before its fields. */
    bringIn: () => string;
    /** Look up's note. */
    leftEmpty: (p: { noun: string }) => string;
    /** Group and total, Sort: before the field. */
    by: () => string;
    /** Group and total: before the first total, and each after it. */
    thenTotal: (p: { first: boolean }) => string;
    /** Before a name. */
    as: () => string;
    /** Group and total: all rows together. */
    allRowsTogether: () => string;
    /** Count the rows' row. */
    givesOneWholeNumber: () => string;
    /** Fill: before the field. */
    where: () => string;
    /** Fill: before the value. */
    isMissingUse: () => string;
    /** Open each list: before the list. */
    open: () => string;
    /** Open each list: after it — `one row per line, keeping the order ID`. */
    onePer: (p: { item: string; keeping?: string }) => string;
    /** Take part of a date: before the part. */
    takeThe: () => string;
    /** Take part of a date: before the date. */
    of: () => string;
    /** List every part's row. */
    everyLevel: (p: { fields: string }) => string;
    /** Try the model: before the start — `price from`. */
    inputFrom: (p: { input: string }) => string;
    /** Try the model: before the end. */
    to: () => string;
    /** Try the model: before the step. */
    every: () => string;
    /** Try the model: before the result's name. */
    callTheResult: () => string;
    /** A filter's foot. */
    addCondition: () => string;
    /** A filter's foot. */
    addGroup: () => string;
    /** Group and total's foot. */
    addTotal: () => string;
    /** Show only fields' foot, Look up's add. */
    addField: () => string;
    /** A row's remove. */
    remove: () => string;
    /** A group's remove. */
    removeGroup: () => string;
    /** An empty slot's word. */
    placeholder: (p: { slot: SlotKind }) => string;
    /** A total. */
    total: (p: { fn: TotalName }) => string;
    /** An order — `highest first`. */
    direction: (p: { dir: "asc" | "desc"; kind: "date" | "text" | "number" }) => string;
    /** A part of a date. */
    part: (p: { part: "year" | "month" | "weekday" }) => string;
    /** What a part of a date gives, for the list. */
    partExample: (p: { part: "year" | "month" | "weekday" }) => string;
    /** A list of names — `a, b and c`. */
    list: (p: { items: readonly string[] }) => string;

    // ── The autocomplete ─────────────────────────────────────────────────
    /** A slot's popover label. */
    slotLabel: (p: { slot: SlotKind }) => string;
    /** Its filter's placeholder. */
    slotPlaceholder: (p: { slot: SlotKind }) => string;
    /** Its footer: where its options come from. */
    slotHint: (p: { slot: SlotKind }) => string;
    /** What it says with nothing to offer. */
    slotEmpty: (p: { slot: SlotKind }) => string;
    /** The footer's keys. */
    slotKeys: () => string;
    /** A group of the rows' own fields. */
    fieldsGroup: () => string;
    /** A group of a variant's payload fields — `Inside status`. */
    insideGroup: (p: { parent: string }) => string;
    /** A group of a list item's fields — `Each line`. */
    eachGroup: (p: { noun: string }) => string;
    /** A payload field before the rows are narrowed — `shipped orders only`. */
    onlyCase: (p: { rows: string }) => string;
    /** The comparisons' group. */
    compareGroup: () => string;
    /** A variant's cases. */
    casesGroup: () => string;
    /** Text values in the data. */
    valuesGroup: () => string;
    /** Numbers from the summary. */
    fromDataGroup: () => string;
    /** Years in the data. */
    yearsGroup: () => string;
    /** Months in the data. */
    monthsGroup: () => string;
    /** How many items. */
    itemsGroup: () => string;
    /** A value typed. */
    typedGroup: () => string;
    /** The match's group. */
    matchGroup: () => string;
    /** Group by's own entries. */
    groupGroup: () => string;
    /** The totals' group. */
    totalGroup: () => string;
    /** The orders' group. */
    orderGroup: () => string;
    /** The parts' group. */
    partGroup: () => string;
    /** The lookup tables' group. */
    datasetsGroup: () => string;
    /** A lookup table's fields — `From customers`. */
    fromDatasetGroup: (p: { dataset: string }) => string;
    /** A model's other inputs: values typed or offered. */
    inputGroup: () => string;
    /** The add-step list's steps. */
    addStepGroup: () => string;
    /** Saved queries offered when there are no steps. */
    savedGroup: () => string;
    /** A value typed, offered first — `Use “2026”`. */
    useTyped: (p: { text: string }) => string;
    /** A match's detail. */
    matchDetail: (p: { match: "all" | "any" }) => string;
    /** All rows together's detail. */
    oneRowOfTotals: () => string;
    /** A number's place in the data. */
    stat: (p: { stat: "lowest" | "median" | "average" | "highest" }) => string;
    /** A day offered for on or after — `start of month · 4 orders`. */
    startOfMonth: (p: { rows: string }) => string;
    /** How many items — `items`. */
    itemsWord: (p: { n: number }) => string;
    /** A lookup table's size — `8 customers`. */
    entries: (p: { count: string; noun: string }) => string;

    // ── A summary in words ───────────────────────────────────────────────
    /** How many different values — `8 values`. */
    distinctValues: (p: { count: string; n: number }) => string;
    /** How many cases occur — `3 cases`. */
    casesUsed: (p: { count: string; n: number }) => string;
    /** The least and greatest — `0.85 – 3,646.84`. */
    span: (p: { from: string; to: string }) => string;
    /** The shortest and longest list — `1–4 each`. */
    lengths: (p: { from: string; to: string }) => string;
    /** How many are missing — `12 missing`. */
    missing: (p: { count: string; n: number }) => string;
    /** Joins a summary's parts. */
    summaryJoin: (p: { parts: readonly string[] }) => string;

    // ── Problems (§4.6) ──────────────────────────────────────────────────
    /** A step that takes rows, on one value. */
    noRowsHere: (p: { shape: string; verb: string }) => string;
    /** A slot not filled in — `Choose a field.` */
    choose: (p: { what: string }) => string;
    /** What an unfinished slot asks for, by the steps' word for it. */
    what: (p: { what: string }) => string;
    /** A field of the wrong kind. */
    wrongKind: (p: { label: string; kind: string; what: string }) => string;
    /** A field the rows do not have. */
    unknownField: (p: { name: string; labels: string; more: boolean }) => string;
    /** A payload field before the rows are narrowed. */
    onlyCaseHas: (p: { rows: string; label: string }) => string;
    /** A case the variant does not have. */
    unknownCase: (p: { label: string; cases: string; value: string }) => string;
    /** A variant compared whole. */
    wholeVariant: (p: { label: string }) => string;
    /** No comparison. */
    chooseComparison: () => string;
    /** No value. */
    enterValue: () => string;
    /** A comparison the field's kind does not take. */
    comparisonNotForKind: (p: { cmp: string; kind: string }) => string;
    /** Has at least, given no whole number. */
    enterItems: () => string;
    /** In year, given no year. */
    enterYear: () => string;
    /** In month, given no month. */
    enterMonth: () => string;
    /** On or after and before, given no date. */
    enterDate: () => string;
    /** A number field given text. */
    notANumber: (p: { label: string; kind: string; value: string }) => string;
    /** A whole number compared with a fraction. */
    neverEqual: (p: { label: string; value: string }) => string;
    /** An inner condition not finished. */
    finishInner: () => string;
    /** An empty group. */
    emptyGroup: () => string;
    /** A filter with no conditions. */
    emptyFilter: () => string;
    /** A Look up in a data source that is not a lookup table. */
    notLookupTable: (p: { dataset: string }) => string;
    /** A Look up by a key of another kind. */
    keyKind: (p: { dataset: string; kind: string; label: string; keyKind: string }) => string;
    /** A Look up of a field its records lack. */
    noRecordField: (p: { noun: string; field: string }) => string;
    /** Group and total with nothing to group by. */
    chooseGroupBy: () => string;
    /** Adding up what is not a number. */
    cannotAddUp: (p: { label: string; kind: string }) => string;
    /** The lowest or highest of what has no order. */
    noLowestHighest: (p: { label: string }) => string;
    /** Two fields of one name. */
    duplicateName: (p: { name: string }) => string;
    /** Keep the first, given no count. */
    keepFirstCount: () => string;
    /** Fill on a field never missing. */
    neverMissing: (p: { label: string }) => string;
    /** List every part with no tree. */
    noTree: () => string;
    /** Try the model with no calculation. */
    noCalculation: () => string;
    /** A range that gives nothing. */
    emptyRange: () => string;
    /** A range longer than a run returns. */
    longRange: (p: { max: string }) => string;
    /** A bracket closed that was never opened. */
    strayBracket: () => string;
    /** Text without its closing quote. */
    unclosedText: () => string;
    /** A bracket never closed. */
    unclosedBracket: () => string;
    /** A pipe at the end. */
    trailingPipe: () => string;
    /** Nothing written. */
    emptyQuery: () => string;
    /** A data source the root does not have. */
    noDataSource: (p: { name: string }) => string;
    /** A program that does not start from a data source. */
    startFromSource: () => string;
    /** A jq step's note. */
    customJq: () => string;
    /** A builtin queries leave out. */
    excludedBuiltin: (p: { name: string }) => string;
    /** A select over a list's items. */
    rowsMoreThanOnce: () => string;

    // ── Fixes ────────────────────────────────────────────────────────────
    /** Keep only a case's rows first. */
    fixNarrow: (p: { rows: string }) => string;
    /** Use another field or value. */
    fixUse: (p: { label: string }) => string;
    /** Compare a variant's case. */
    fixUnwhole: (p: { field: string }) => string;
    /** Take the step out. */
    fixRemoveStep: () => string;

    // ── The generated description (§4.13) ───────────────────────────────
    /** Try the model — `Demand over price from 10 to 12 in steps of 0.5, region NSW`. */
    describeModel: (p: { result: string; input: string; from: string; to: string; step: string; fixed: readonly string[] }) => string;
    /** A fixed input — `region NSW`. */
    describeFixed: (p: { name: string; value: string }) => string;
    /** Totals of all rows — `Total cost, parts and dearest across every part in the tree`. */
    describeAllTotals: (p: { totals: string; source: string; where: string }) => string;
    /** The top groups — `Top 3 regions by revenue from orders where …`. */
    describeTopGroups: (p: { n: string; groups: string; sort: string; source: string; where: string }) => string;
    /** Totals per group — `Revenue and orders per region from orders`. */
    describeGroups: (p: { totals: string; group: string; source: string; where: string; sorted: string }) => string;
    /** A count — `Count of orders where status is cancelled`. */
    describeCount: (p: { source: string; where: string }) => string;
    /** The first rows — `Top 10 orders by total where …, with name and region from customers`. */
    describeFirst: (p: { top: boolean; n: string; source: string; sort: string; where: string; with: string }) => string;
    /** Rows — `Orders where …, sorted by total, highest first`. */
    describeRows: (p: { source: string; where: string; with: string; sorted: string }) => string;
    /** The filters — ` where status is shipped and total is at least 100`. */
    describeWhere: (p: { conditions: readonly string[] }) => string;
    /** A filter's conditions joined — `status is shipped or total is at least 1,500`. */
    describeConditions: (p: { match: "all" | "any"; conditions: readonly string[] }) => string;
    /** A group of conditions in a sentence. */
    describeGroup: (p: { match: "all" | "any"; conditions: readonly string[] }) => string;
    /** A condition — `total is at least 100`. */
    describeCondition: (p: { field: string; cmp: ComparisonKind; value: string }) => string;
    /** Look ups — `, with name and region from customers`. */
    describeWith: (p: { lookups: readonly { fields: string; dataset: string }[] }) => string;
    /** A sort — `, sorted by total, highest first`. */
    describeSorted: (p: { field: string; desc: boolean }) => string;
    /** A sort for the top rows — ` by total`. */
    describeBy: (p: { field: string }) => string;
    /** The rows a list opens — `order lines`. */
    describeDrilled: (p: { noun: string; list: string }) => string;
    /** The parts of a tree — `every bom in the tree`. */
    describeWalked: (p: { noun: string }) => string;
    /** Cut at a word. */
    ellipsis: () => string;

    // ── A step in words, for an outline ──────────────────────────────────
    /** Look up — `name and region from customers by customer ID`. */
    outlineLookup: (p: { fields: string; dataset: string; key: string }) => string;
    /** Group and total — `revenue and orders per region`, `total cost and parts of all rows`. */
    outlineGroup: (p: { totals: string; group?: string }) => string;
    /** Sort — `by total, highest first`. */
    outlineSort: (p: { field: string; direction: string }) => string;
    /** Keep the first — `10 orders`, after its title. */
    outlineLimit: (p: { rows: string }) => string;
    /** Fill in missing values — `0 where discount is missing`. */
    outlineFill: (p: { field: string; value: string }) => string;
    /** Take part of a date — `the month of shipped date as ship month`. */
    outlineDatePart: (p: { part: string; field: string; name: string }) => string;
    /** Try the model — `price from 10 to 12 every 0.5, region NSW`. */
    outlineModel: (p: { input: string; from: string; to: string; step: string; fixed: readonly string[] }) => string;
}

const STEP_TITLE: Readonly<Record<Exclude<StepKind, "drill">, string>> = {
    filter: "Keep rows where",
    lookup: "Look up from another dataset",
    group: "Group and total",
    sort: "Sort",
    limit: "Keep the first",
    count: "Count the rows",
    pick: "Show only these fields",
    fill: "Fill in missing values",
    datepart: "Take part of a date",
    walk: "List every part in the tree",
    tabulate: "Try the model over a range",
    jq: "jq step",
};

const STEP_VERB: Readonly<Record<StepKind, string>> = {
    filter: "filter", lookup: "look up", group: "group", sort: "sort", limit: "keep", count: "count", pick: "choose fields from",
    fill: "fill in", drill: "open", datepart: "read dates from", walk: "walk", tabulate: "call", jq: "run",
};

const ADD_STEP_HINT: Readonly<Record<StepKind, string>> = {
    filter: "Keep only the rows that match",
    lookup: "Bring in fields from a lookup table by key",
    group: "One row per group, with totals",
    sort: "Order the rows",
    limit: "The first rows only",
    count: "Gives one number",
    pick: "Pick and rename fields",
    fill: "Use a default where a value is missing",
    drill: "One row per item in a list",
    datepart: "Year, month or weekday",
    walk: "Walk every nested level",
    tabulate: "One row per input value",
    jq: "Write the step in jq",
};

const ADD_STEP_KEYWORDS: Readonly<Record<StepKind, string>> = {
    filter: "filter where select only matching remove exclude",
    lookup: "join lookup bring match",
    group: "group sum total add up count average mean aggregate pivot per by",
    sort: "sort order rank highest lowest top",
    limit: "first top limit head n",
    count: "count how many number length total rows",
    pick: "pick select columns fields rename show only hide choose",
    fill: "missing default null empty fill blank",
    drill: "flatten expand lines unnest open list each items",
    datepart: "date year month week day part time",
    walk: "recurse tree walk nested children parts flatten all",
    tabulate: "call model function range what if tabulate",
    jq: "jq code custom",
};

const COMPARISON: Readonly<Record<ComparisonKind, string>> = {
    eq: "is", ne: "is not", ge: "is at least", le: "is at most", gt: "is more than", lt: "is less than",
    contains: "contains", startsWith: "starts with", missing: "is missing", present: "has a value", yes: "is yes", no: "is no",
    inYear: "is in year", inMonth: "is in month", onOrAfter: "is on or after", before: "is before",
    lengthAtLeast: "has at least", anyWhere: "has any where",
};

const SLOT_LABEL: Readonly<Record<SlotKind, string>> = {
    "match": "Match", "group-match": "Match",
    "field": "Field", "cmp": "Compare", "value": "Value",
    "key": "Find by", "dataset": "Dataset", "lookup-add": "Bring in",
    "by": "Group by", "agg-fn": "Total", "agg-field": "Of",
    "sort-field": "Sort by", "dir": "Order",
    "pick-field": "Field", "pick-add": "Add field",
    "fill-field": "Field", "drill-field": "List", "via": "List",
    "part": "Part", "date-field": "Date",
    "fixed": "Value",
    "add-step": "Add a step",
};

const PLACEHOLDER: Readonly<Record<SlotKind, string>> = {
    "match": "choose", "group-match": "choose",
    "field": "field", "cmp": "compare", "value": "value",
    "key": "field", "dataset": "dataset", "lookup-add": "field",
    "by": "field", "agg-fn": "total", "agg-field": "field",
    "sort-field": "field", "dir": "order",
    "pick-field": "field", "pick-add": "field",
    "fill-field": "field", "drill-field": "list", "via": "list",
    "part": "part", "date-field": "date",
    "fixed": "value",
    "add-step": "step",
};

/** Whether a slot takes a value, typed or offered. */
const takesValue = (slot: SlotKind): boolean => slot === "value" || slot === "fixed";
/** Whether a slot offers fields of the checked type. */
const takesField = (slot: SlotKind): boolean =>
    slot === "field" || slot === "key" || slot === "by" || slot === "agg-field" || slot === "sort-field" || slot === "pick-field"
    || slot === "pick-add" || slot === "fill-field" || slot === "drill-field" || slot === "via" || slot === "date-field" || slot === "lookup-add";

/** `a`, `a and b`, `a, b and c`. */
function englishList(items: readonly string[]): string {
    if (items.length < 2) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A sentence's first letter in capitals. */
function capital(text: string): string {
    return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** The query builder's English messages — the default table. */
export const queryMessages: QueryMessages = {
    stepTitle: ({ kind, noun }) => (kind === "drill" ? `Open each ${noun}'s list` : STEP_TITLE[kind]),
    stepVerb: ({ kind }) => STEP_VERB[kind],
    addStepLabel: ({ kind, noun }) => {
        switch (kind) {
            case "filter": return "Keep rows where…";
            case "lookup": return "Look up from another dataset…";
            case "group": return "Group and total…";
            case "sort": return "Sort by…";
            case "limit": return "Keep the first…";
            case "count": return "Count the rows";
            case "pick": return "Show only some fields…";
            case "fill": return "Fill in missing values…";
            case "drill": return `Open each ${noun}'s list…`;
            case "datepart": return "Take part of a date…";
            case "walk": return "List every part in the tree";
            case "tabulate": return "Try the model over a range…";
            case "jq": return "jq step";
        }
    },
    addStepHint: ({ kind }) => ADD_STEP_HINT[kind],
    addStepKeywords: ({ kind }) => ADD_STEP_KEYWORDS[kind],
    quickAddLabel: ({ kind }) => {
        switch (kind) {
            case "filter": return "Keep rows";
            case "group": return "Group and total";
            case "sort": return "Sort by";
            case "limit": return "Keep the first";
            case "pick": return "Show only fields";
            case "walk": return "List every part in the tree";
            case "tabulate": return "Try the model over a range";
            default: return STEP_VERB[kind];
        }
    },
    needsTree: () => "Needs a tree of parts",
    needsCalculation: () => "Needs a calculation",
    nothingToUse: () => "Nothing to use it on here",
    needsRows: ({ shape }) => `Needs rows — the query gives ${shape} here`,
    notFinished: () => "Not in the query until it's finished.",
    noSteps: () => "Add a step to narrow, reshape or total the rows, or start from a saved query.",
    addStepAtEnd: () => "Add a step at the end",
    quickAdd: () => "Quick add",
    insert: () => "Insert",
    startWith: ({ source }) => `Start with ${source}`,

    comparison: ({ cmp }) => COMPARISON[cmp],
    comparisonDetail: ({ cmp }) => (cmp === "anyWhere" ? "check the items in the list" : ""),

    kind: ({ kind, items, cases }) => {
        switch (kind) {
            case "text": return "text";
            case "wholeNumber": return "whole number";
            case "number": return "number";
            case "date": return "date";
            case "yesNo": return "yes or no";
            case "nothing": return "nothing";
            case "bytes": return "bytes";
            case "oneOf": return cases === undefined ? "one of" : `one of ${cases}`;
            case "list": return items === undefined ? "list" : `list of ${items}`;
            case "lookupTable": return "lookup table";
            case "calculation": return "calculation";
            case "record": return "record";
            case "tree": return items === undefined ? "tree" : `tree of ${items}`;
            case "value": return "value";
        }
    },
    sometimesMissing: ({ kind }) => `${kind}, sometimes missing`,
    shapeMany: ({ rows }) => `Many ${rows}`,
    shapeUpTo: ({ count, rows }) => `Up to ${count} ${rows}`,
    shapeOne: ({ kind, noun }) => {
        switch (kind) {
            case "wholeNumber": return "One whole number";
            case "number": return "One number";
            case "text": return "One text value";
            case "record": return "One record";
            case "tree": return `One ${noun} tree`;
            case "calculation": return "One calculation";
            case "list": return "One list";
            case "lookupTable": return "One lookup table";
            case "value": return "One value";
        }
    },
    shapeUnknown: () => "Shape not known until the problems above are fixed",
    countRows: ({ count, rows }) => `${count} ${rows}`,
    rows: ({ adjective, noun }) => (adjective === "" ? noun : `${adjective} ${noun}`),
    fieldsAdded: ({ fields }) => `+ ${fields}`,
    gives: ({ shape }) => `Gives ${shape.length === 0 ? shape : shape.charAt(0).toLowerCase() + shape.slice(1)}`,

    match: ({ match }) => match,
    ofThese: ({ match }) => (match === "any" ? "of these is true" : "of these are true"),
    joiner: ({ match }) => (match === "any" ? "or" : "and"),
    find: () => "find",
    inDataset: () => "in",
    bringIn: () => "bring in",
    leftEmpty: ({ noun }) => `Left empty when a ${noun} isn't found.`,
    by: () => "by",
    thenTotal: ({ first }) => (first ? "then" : "and"),
    as: () => "as",
    allRowsTogether: () => "all rows together",
    givesOneWholeNumber: () => "gives one whole number",
    where: () => "where",
    isMissingUse: () => "is missing, use",
    open: () => "open",
    onePer: ({ item, keeping }) => (keeping === undefined ? `one row per ${item}` : `one row per ${item}, keeping the ${keeping} ID`),
    takeThe: () => "take the",
    of: () => "of",
    everyLevel: ({ fields }) => `every level, keeping ${fields}`,
    inputFrom: ({ input }) => `${input} from`,
    to: () => "to",
    every: () => "every",
    callTheResult: () => "call the result",
    addCondition: () => "Add condition",
    addGroup: () => "Add group",
    addTotal: () => "Add a total",
    addField: () => "Add field",
    remove: () => "Remove",
    removeGroup: () => "Remove group",
    placeholder: ({ slot }) => PLACEHOLDER[slot],
    total: ({ fn }) => {
        switch (fn) {
            case "sum": return "add up";
            case "count": return "count";
            case "mean": return "average";
            case "min": return "lowest";
            case "max": return "highest";
            case "distinct": return "count different";
        }
    },
    direction: ({ dir, kind }) => {
        const [desc, asc] = kind === "date" ? ["newest first", "oldest first"] : kind === "text" ? ["Z to A", "A to Z"] : ["highest first", "lowest first"];
        return dir === "desc" ? desc! : asc!;
    },
    part: ({ part }) => part,
    partExample: ({ part }) => (part === "year" ? "2026" : part === "month" ? "2026-03" : "Tuesday"),
    list: ({ items }) => englishList(items),

    slotLabel: ({ slot }) => SLOT_LABEL[slot],
    slotPlaceholder: ({ slot }) => (takesValue(slot) ? "Type or pick a value" : "Type to filter"),
    slotHint: ({ slot }) => (takesValue(slot) ? "Values from the dataset summary"
        : slot === "add-step" ? "Only steps that fit the current shape"
        : slot === "dataset" ? "The lookup tables this builder reads"
        : takesField(slot) ? "Fields from the checked type"
        : ""),
    slotEmpty: ({ slot }) => (takesValue(slot) ? "Type a value, then press ⏎." : "Nothing matches."),
    slotKeys: () => "↑↓ ⏎ esc",
    fieldsGroup: () => "Fields",
    insideGroup: ({ parent }) => `Inside ${parent}`,
    eachGroup: ({ noun }) => `Each ${noun}`,
    onlyCase: ({ rows }) => `${rows} only`,
    compareGroup: () => "Compare",
    casesGroup: () => "Cases",
    valuesGroup: () => "Values in the data",
    fromDataGroup: () => "From the data",
    yearsGroup: () => "Years in the data",
    monthsGroup: () => "Months in the data",
    itemsGroup: () => "Items",
    typedGroup: () => "Typed",
    matchGroup: () => "Match",
    groupGroup: () => "Group",
    totalGroup: () => "Total",
    orderGroup: () => "Order",
    partGroup: () => "Part",
    datasetsGroup: () => "Lookup tables",
    fromDatasetGroup: ({ dataset }) => `From ${dataset}`,
    inputGroup: () => "Values",
    addStepGroup: () => "Add a step",
    savedGroup: () => "Start from a saved query",
    useTyped: ({ text }) => `Use “${text}”`,
    matchDetail: ({ match }) => (match === "any" ? "at least one holds" : "every condition holds"),
    oneRowOfTotals: () => "one row of totals",
    stat: ({ stat }) => stat,
    startOfMonth: ({ rows }) => `start of month · ${rows}`,
    itemsWord: ({ n }) => (n === 1 ? "item" : "items"),
    entries: ({ count, noun }) => `${count} ${noun}`,

    distinctValues: ({ count, n }) => `${count} ${n === 1 ? "value" : "values"}`,
    casesUsed: ({ count, n }) => `${count} ${n === 1 ? "case" : "cases"}`,
    span: ({ from, to }) => `${from} – ${to}`,
    lengths: ({ from, to }) => `${from}–${to} each`,
    missing: ({ count }) => `${count} missing`,
    summaryJoin: ({ parts }) => parts.join(" · "),

    noRowsHere: ({ shape, verb }) => `${shape} — there are no rows to ${verb} here.`,
    choose: ({ what }) => `Choose ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}.`,
    what: ({ what }) => what,
    wrongKind: ({ label, kind, what }) => `${capital(label)} is ${kind} — pick ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}.`,
    unknownField: ({ name, labels, more }) => `There's no “${name}” here. The rows have ${labels}${more ? "…" : "."}`,
    onlyCaseHas: ({ rows, label }) => `Only ${rows} have a ${label}.`,
    unknownCase: ({ label, cases, value }) => `${capital(label)} can be ${cases} — not “${value}”.`,
    wholeVariant: ({ label }) => `Compare the ${label} case, not the whole value.`,
    chooseComparison: () => "Choose how to compare.",
    enterValue: () => "Enter a value.",
    comparisonNotForKind: ({ cmp, kind }) => `“${cmp}” doesn't work on ${kind}.`,
    enterItems: () => "Enter a whole number of items.",
    enterYear: () => "Enter a year, like 2026.",
    enterMonth: () => "Enter a month, like 2026-03.",
    enterDate: () => "Enter a date, like 2026-03-01.",
    notANumber: ({ label, kind, value }) => `${capital(label)} is a ${kind} — “${value}” isn't one.`,
    neverEqual: ({ label, value }) => `${capital(label)} is a whole number, so it can never equal ${value}.`,
    finishInner: () => "Finish the inner condition.",
    emptyGroup: () => "This group is empty.",
    emptyFilter: () => "Add a condition, or remove this step.",
    notLookupTable: ({ dataset }) => `${capital(dataset)} can't be looked up by key.`,
    keyKind: ({ dataset, kind, label, keyKind }) => `${capital(dataset)} are found by ${kind} ids, but ${label} is ${/^[aeiou]/i.test(keyKind) ? "an" : "a"} ${keyKind}.`,
    noRecordField: ({ noun, field }) => `${capital(noun)} records have no “${field}”.`,
    chooseGroupBy: () => "Choose what to group by.",
    cannotAddUp: ({ label, kind }) => `Can't add up ${label} — it's ${kind}. Pick a number, or count instead.`,
    noLowestHighest: ({ label }) => `${capital(label)} has no lowest or highest.`,
    duplicateName: ({ name }) => `Two fields are called ${name}; the last one wins.`,
    keepFirstCount: () => "Keep the first needs a whole number, 1 or more.",
    neverMissing: ({ label }) => `${capital(label)} is never missing, so this changes nothing.`,
    noTree: () => "There is no tree to walk here.",
    noCalculation: () => "There is no calculation to try here.",
    emptyRange: () => "The range needs a start below the end and a step above 0.",
    longRange: ({ max }) => `That range gives more than ${max} rows; results will be cut off.`,
    strayBracket: () => "The jq has a stray bracket.",
    unclosedText: () => "A text value is missing its closing quote.",
    unclosedBracket: () => "A bracket is never closed.",
    trailingPipe: () => "The query ends with a pipe.",
    emptyQuery: () => "The query is empty.",
    noDataSource: ({ name }) => `There's no data source called “${name}”.`,
    startFromSource: () => "Start the query from a data source.",
    customJq: () => "Custom jq step.",
    excludedBuiltin: ({ name }) => `${name} isn't available in queries.`,
    rowsMoreThanOnce: () => "Rows can appear more than once.",

    fixNarrow: ({ rows }) => `Keep only ${rows} first`,
    fixUse: ({ label }) => `Use ${label}`,
    fixUnwhole: ({ field }) => `Use .${field}.type`,
    fixRemoveStep: () => "Remove this step",

    describeModel: ({ result, input, from, to, step, fixed }) =>
        `${capital(result)} over ${input} from ${from} to ${to} in steps of ${step}${fixed.map(f => `, ${f}`).join("")}`,
    describeFixed: ({ name, value }) => `${name} ${value}`,
    describeAllTotals: ({ totals, source, where }) => `${capital(totals)} across ${source}${where}`,
    describeTopGroups: ({ n, groups, sort, source, where }) => `Top ${n} ${groups} by ${sort} from ${source}${where}`,
    describeGroups: ({ totals, group, source, where, sorted }) => `${capital(totals)} per ${group} from ${source}${where}${sorted}`,
    describeCount: ({ source, where }) => `Count of ${source}${where}`,
    describeFirst: ({ top, n, source, sort, where, with: withs }) => `${top ? "Top" : "First"} ${n} ${source}${sort}${where}${withs}`,
    describeRows: ({ source, where, with: withs, sorted }) => `${capital(source)}${where}${withs}${sorted}`,
    describeWhere: ({ conditions }) => (conditions.length === 0 ? "" : ` where ${conditions.join(" and ")}`),
    describeConditions: ({ match, conditions }) => (match === "any" ? conditions.join(" or ") : englishList(conditions)),
    describeGroup: ({ match, conditions }) => (conditions.length > 1 ? `(${conditions.join(match === "any" ? " or " : " and ")})` : conditions[0] ?? ""),
    describeCondition: ({ field, cmp, value }) => {
        // "is in year 2026" reads better as "is in 2026".
        const words = cmp === "inYear" || cmp === "inMonth" ? "is in" : COMPARISON[cmp];
        return value === "" ? `${field} ${words}` : `${field} ${words} ${value}`;
    },
    describeWith: ({ lookups }) => (lookups.length === 0 ? "" : `, with ${lookups.map(l => `${l.fields} from ${l.dataset}`).join(" and ")}`),
    describeSorted: ({ field, desc }) => `, sorted by ${field}${desc ? ", highest first" : ""}`,
    describeBy: ({ field }) => ` by ${field}`,
    describeDrilled: ({ noun, list }) => `${noun} ${list}`,
    describeWalked: ({ noun }) => `every ${noun} in the tree`,
    ellipsis: () => "…",

    outlineLookup: ({ fields, dataset, key }) => `${fields} from ${dataset} by ${key}`,
    outlineGroup: ({ totals, group }) => (group === undefined ? `${totals} of all rows` : `${totals} per ${group}`),
    outlineSort: ({ field, direction }) => `by ${field}, ${direction}`,
    outlineLimit: ({ rows }) => rows,
    outlineFill: ({ field, value }) => `${value} where ${field} is missing`,
    outlineDatePart: ({ part, field, name }) => `the ${part} of ${field} as ${name}`,
    outlineModel: ({ input, from, to, step, fixed }) => `${input} from ${from} to ${to} every ${step}${fixed.map(f => `, ${f}`).join("")}`,
};

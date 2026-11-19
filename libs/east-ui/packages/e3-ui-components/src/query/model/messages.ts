/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the query builder's model says (#934) — ONE typed message table:
 * the steps' titles, verbs and add-step entries; the comparisons; kinds,
 * shapes and counts; the parts of a step card; the autocomplete's labels,
 * groups and offers; a summary's words; the plain sentence for each problem
 * and fix (`Query Editor Spec.md` §4.6); the generated description (§4.13);
 * the builder's own chrome (#935); and a run's plan, its path and why, its
 * stages and its pruning (#941). What the AUTHOR wrote, and what the
 * data holds — a field's name, a case, a value, a saved query's name — is
 * data, and never passes through it.
 *
 * This is the table's type. English is the default (`messages-en.ts`). The
 * model's functions take the table as a parameter, so a renderer passes its
 * own; numbers arrive already formatted for the locale, and `n` is the raw
 * count, for plurals.
 *
 * @packageDocumentation
 */

import type { JqTotal, JqWholeReason } from "@elaraai/east";
import type { ComparisonKind, StepKind } from "../steps/values.js";
import type { InputKind } from "./refs.js";

/** What a slot asks for: each kind of slot a step card has. */
export type SlotKind =
    | "match" | "group-match"
    | "field" | "cmp" | "value"
    | "key" | "dataset" | "lookup-add"
    | "by" | "by-add" | "agg-fn" | "agg-field" | "agg-per"
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
export type TotalName = "count" | "sum" | "mean" | "min" | "max" | "distinct" | "ratio";

/** What one value is, for the shape of a query that gives one. */
export type OneKind = "wholeNumber" | "number" | "text" | "record" | "tree" | "calculation" | "list" | "lookupTable" | "value";

/** Why a query runs as one unit: the code of east's reason (`JqWholeReason`). */
export type PlanWholeCode = JqWholeReason["code"];

/** How one total's parts combine: east's rule (`JqTotal`). */
export type PlanTotalRule = JqTotal["rule"];

/**
 * How a split's pieces' outputs combine, as a plan's explanation says it: the
 * rows joined; totals; rows grouped by a key, then each group's totals
 * combined or its rows collected; the distinct rows; the first row of each
 * key; a reduce's updates, added or the last kept.
 */
export type PlanCombineKind = "concat" | "totals" | "group" | "groupTotals" | "groupRows" | "distinct" | "distinctBy" | "reduceAdd" | "reduceReplace";

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
    /** A comparison, as its list offers it — `is at least`, `is in the last … days`. */
    comparison: (p: { cmp: ComparisonKind }) => string;
    /** Beside a comparison in the list, when it needs saying. */
    comparisonDetail: (p: { cmp: ComparisonKind }) => string;
    /** A comparison in a step card's slot, before its value — `is at least`, `is in the last` (#1670). */
    comparisonSlot: (p: { cmp: ComparisonKind }) => string;
    /** After an "is in the last" value, its unit — `days`, `day`; `""` for any other comparison. */
    lastUnit: (p: { cmp: ComparisonKind; n: number }) => string;

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
    /** Group and total: before the field a ratio is per (#1670). */
    per: () => string;
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
    /** How many hours, days or weeks back an "is in the last" counts (#1670). */
    lastGroup: () => string;
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
    /** Is in the last, given no whole number — `Enter a whole number of days.` (#1670) */
    enterLast: (p: { unit: string }) => string;
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
    /** A condition — `total is at least 100`, `ordered is in the last 7 days`; `n` the value's number, for a unit's plural. */
    describeCondition: (p: { field: string; cmp: ComparisonKind; value: string; n?: number }) => string;
    /**
     * A condition as a filter's chip says it, short (#1673): its field, then what it holds, the comparison's "is" left
     * out — `Region: NSW`, `Units: more than 1`, `Ordered at: in the last 7 days`; `n` the value's number, for a unit's plural.
     */
    chipCondition: (p: { field: string; cmp: ComparisonKind; value: string; n?: number }) => string;
    /** How many conditions a filter's chip holds past its first, each said once — `+2`; `count` is formatted. */
    chipMore: (p: { count: string; n: number }) => string;
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

    // ── The toolbar, the Query tab and the status line (#936) ────────────
    /** The Visual · jq switch's name. */
    viewLabel: () => string;
    /** A view of the query. */
    view: (p: { view: "visual" | "jq" }) => string;
    /** Copy jq. */
    copyJq: () => string;
    /** Copy jq, just after it copied. */
    copied: () => string;
    /** The toolbar's Save…, which opens the save popover. */
    saveAs: () => string;
    /** Run. */
    run: () => string;
    /** Run, while a run goes. */
    running: () => string;
    /** Run's keys, in its `Kbd`. */
    runKeys: () => string;
    /** Run's tooltip. */
    runTip: () => string;
    /** The ⋯ chip a row short of room folds Copy jq and Save… into (#1229) — its accessible name. */
    more: () => string;
    /** The steps' list, for a screen reader. */
    stepsLabel: () => string;
    /** A step's place, before its title — `1`. */
    stepNumber: (p: { n: string }) => string;
    /** Move a step up. */
    moveUp: () => string;
    /** Move a step down. */
    moveDown: () => string;
    /** Take a step out. */
    removeStep: () => string;
    /** A shape line's Insert, in full. */
    insertHere: () => string;
    /** The check, clean. */
    checksClean: () => string;
    /** Steps left to finish — `2 to finish`. */
    toFinish: (p: { count: string; n: number }) => string;
    /** Problems that stop the query running — `1 problem`. */
    problemCount: (p: { count: string; n: number }) => string;
    /** Warnings, in the jq view — `2 warnings`. */
    warningCount: (p: { count: string; n: number }) => string;
    /** The shape's East type and multiplicity, on hover — `Array<Struct{…}> · one`. */
    typeHover: (p: { type: string; multiplicity: string }) => string;
    /** The fields of the rows the query gives, after its shape — `· order, customer, total`. */
    givesFields: (p: { fields: readonly string[] }) => string;
    /** The source's line under its title — `dev.orders · list of orders`. */
    sourceLine: (p: { path: string; kind: string }) => string;
    /** What an input of a step card edits, for a screen reader. */
    inputLabel: (p: { input: InputKind }) => string;
    /** The save state: saved just now, drafts not yet saved, or never saved. */
    saveState: (p: { state: "saved" | "unsaved" | "new" }) => string;
    /** The jq view's note: unfinished steps left out of the jq. */
    unfinishedLeftOut: (p: { count: string; n: number }) => string;
    /** The jq kept, because it does not parse. */
    fixSyntaxFirst: () => string;
    /** The notice after leaving the jq: parts of it that stay jq steps. */
    jqPartsStay: (p: { count: string; n: number }) => string;
    /** The jq view's text, for a screen reader. */
    jqLabel: () => string;
    /** A gesture's label in the history: a slot set — `Set status`. */
    setGesture: (p: { what: string }) => string;
    /** A step added — `Add Sort`. */
    addStepGesture: (p: { step: string }) => string;
    /** A step taken out — `Remove step 3`. */
    removeStepGesture: (p: { n: string }) => string;
    /** A step moved — `Move step 2 up`. */
    moveStepGesture: (p: { n: string; up: boolean }) => string;
    /** The jq edited and left. */
    editJqGesture: () => string;
    /** The query named, and described, as it saves. */
    nameGesture: () => string;

    // ── The builder (#935) ───────────────────────────────────────────────
    /** The pane's name — its rail's label. */
    pane: () => string;
    /** A tab of the pane. */
    tab: (p: { tab: "query" | "datasets" | "library" }) => string;
    /** A new query's name — `Untitled orders query`. */
    untitled: (p: { source: string }) => string;
    /** The saved queries could not be read. */
    savedUnreadable: (p: { message: string }) => string;
    /** The open saved query is not in the record — its heading. */
    queryGone: (p: { name: string }) => string;
    /** Under it. */
    queryGoneHint: () => string;
    /** A paged data source read through one of a record's indexes. */
    sourceThroughIndex: (p: { name: string; index: string }) => string;
    /** A paged data source no handle on the page serves. */
    sourceUnbound: (p: { name: string }) => string;
    /** A saved query reads a data source not bound here — `Reads customers, which isn't here`. */
    rootMissing: (p: { name: string }) => string;
    /** One bound here at another path — `Reads .inputs.archive.orders, not this builder's orders`. */
    rootElsewhere: (p: { path: string; name: string }) => string;
    /** A save under a name another write took first. */
    nameTaken: (p: { name: string }) => string;
    /** A save of a query another write changed since the edit began, and who changed the record last, when known. */
    savedChanged: (p: { name: string; by: string | undefined }) => string;

    // ── Saving (#936) ────────────────────────────────────────────────────
    /** The save popover's head, before the open query's name — `Save query`. */
    saveQuery: () => string;
    /** Its name field's placeholder, and its accessible name. */
    queryName: () => string;
    /** Under the name, while it is empty. */
    queryNameMissing: () => string;
    /** Under the name, while another saved query holds it — `Order count is taken`. */
    queryNameHeld: (p: { name: string }) => string;
    /** Its description field's placeholder, and its accessible name. */
    descriptionPlaceholder: () => string;
    /** Under the description, while it is the sentence generated from the steps. */
    descriptionGenerated: () => string;
    /** Under the description once it is edited: its length and the most it holds — `52/140 · shown under the name in the library`. */
    descriptionCount: (p: { count: string; max: string; n: number }) => string;
    /** Returns the description to the sentence generated from the steps. */
    restoreGenerated: () => string;
    /** The save popover's commit. */
    saveConfirm: () => string;
    /** The save popover's cancel. */
    cancel: () => string;

    // ── The jq view (#937) ───────────────────────────────────────────────
    /** The problems panel's check — `2 problems · 1 warning`, `1 warning`, `Checks clean`; notes are not counted. */
    jqCheck: (p: { problems: string; n: number; warnings: string; w: number }) => string;
    /** The problems panel's hint, after the check. */
    jqHint: () => string;
    /** The problems' list, for a screen reader. */
    jqProblemsLabel: () => string;
    /** A problem's code as the panel shows it: the checker's, its underscores as spaces; a note's, `note`. */
    jqProblemCode: (p: { code: string; note: boolean }) => string;
    /** Where a problem starts — `L3:9`. */
    jqProblemAt: (p: { line: string; column: string }) => string;
    /** The completions' list, for a screen reader. */
    jqCompletionsLabel: () => string;
    /** The footer's line for a completion with no doc — `total · Float`. */
    jqCompletionLine: (p: { label: string; detail: string }) => string;
    /** The completions' keys, in the footer. */
    jqCompletionKeys: () => string;

    // ── Runs and results (#938) ──────────────────────────────────────────
    /** The results' band, for a screen reader. */
    resultControls: () => string;
    /** The Table · Tree switch's name. */
    resultViewLabel: () => string;
    /** A view of the result. */
    resultView: (p: { view: "table" | "tree" }) => string;
    /** The view a run picked, on hover — `Table · picked for many rows`. */
    resultViewPicked: (p: { view: "table" | "tree" }) => string;
    /** Download ▾. */
    download: () => string;
    /** A download's format. */
    downloadFormat: (p: { format: "csv" | "beast2" }) => string;
    /** Beside a format in the menu — `table`, `typed`. */
    downloadFormatMeta: (p: { format: "csv" | "beast2" }) => string;
    /** The note after a download — `Downloaded top-shipped-orders-2026.csv — 10 orders, one row per output.` */
    downloaded: (p: { format: "csv" | "beast2"; file: string; count: string }) => string;
    /** The stale strip's tag, before its words. */
    staleTag: () => string;
    /** The stale strip. */
    staleResult: () => string;
    /** Its run again. */
    runAgain: () => string;
    /** A run the checker refused. */
    notRunProblems: () => string;
    /** A run that raised an error, or that the server refused. */
    notRun: () => string;
    /** A run cut off by its time limit — `Stopped after 30 s`. */
    stoppedAfter: (p: { seconds: string }) => string;
    /** Under it. */
    stoppedHint: () => string;
    /** A result over the call's size limit. */
    tooLarge: () => string;
    /** Under it — `1.4 MB is over the 1 MB limit. Total or narrow the query.` */
    tooLargeHint: (p: { bytes: string; limit: string }) => string;
    /** A query that needs a platform function the server lacks. */
    needsPlatform: () => string;
    /** Under it — `It needs sales_lookup.` */
    needsPlatformHint: (p: { functions: string }) => string;
    /** A call that never reached the server. */
    unreachable: () => string;
    /** The results before any run. */
    idleTitle: () => string;
    /** Its first line. */
    idleChecks: () => string;
    /** Its second. */
    idleRun: () => string;
    /** The same on a phone: no key to name (QP15). */
    idleRunPhone: () => string;
    clearTheSearch: () => string;
    /** While a run reads — `Reading orders, customers`. */
    reading: (p: { sources: string }) => string;
    /** The footer while a run goes. */
    runningWord: () => string;
    /** The footer after a run that gave no result. */
    noResult: () => string;
    /** The footer before any run. */
    noResultYet: () => string;
    /** Rows a run cut, of the rows the query gives — `Showing 1–1,000 of 4,210`. */
    showing: (p: { shown: string; total: string }) => string;
    /** Rows a run cut at the call's most, the total unknown — `1,000+`. */
    atLeast: (p: { count: string }) => string;
    /** A run's own line — `run #3 · 14:02:07 · 412 ms`. */
    runLine: (p: { n: string; time: string; ms: string }) => string;
    /** What a run read — `reads orders #4f2a1c8d · customers #9b07e3a4`. */
    readsLine: (p: { sources: readonly { name: string; hash: string }[] }) => string;
    /** Rows, when the query's rows have no name — `10 rows`. */
    rowCount: (p: { count: string; n: number }) => string;
    /** One value, when its shape has no words. */
    oneValue: () => string;
    /** A size — `1.4 MB`. */
    byteSize: (p: { value: string; unit: "B" | "KB" | "MB" | "GB" }) => string;
    /** A duration — `420 ms`, `2.9 s`, `2.5 min` (#1143). */
    duration: (p: { value: string; unit: "ms" | "s" | "min" }) => string;

    // ── Plans (#941) ─────────────────────────────────────────────────────
    /**
     * The plan's read-out in the results' footer — `One call`, `Split call ·
     * 12 pieces`, `Split call · 3 of 12 pieces done`, `Re-keyed join · 12
     * pieces` (#942), `Split call · 12 pieces · 11 units cached` (#1105).
     */
    planBadge: (p: { kind: "one_shot" | "split" | "rekey"; detail: string }) => string;
    /** The plan's popover's title, and the read-out's name for a screen reader. */
    planTitle: () => string;
    /** A phone's count line and its view (`Query Builder Phone Spec.md` QP3, QP34). */
    notRunYet: () => string;
    thisResult: () => string;
    thisResultQuery: () => string;
    thisResultGives: () => string;
    thisResultRun: () => string;
    thisResultReads: () => string;
    thisResultPlan: () => string;
    /** The Query view's head (QP21), and a step's ⋯ (QP27). */
    queryEyebrow: (p: { state: string; n: number; count: string }) => string;
    stepActions: () => string;
    backToStep: () => string;
    removeCondition: () => string;
    checkerFound: (p: { n: number; count: string; text: string }) => string;
    clearSearchEvery: () => string;
    rowsFromRun: (p: { n: string; time: string }) => string;
    showProblem: () => string;
    thisResultDownload: () => string;
    savedAs: (p: { slug: string }) => string;
    readingShort: () => string;
    noStepsYet: () => string;
    noStepsAdd: () => string;
    noStepsSaved: () => string;
    openLibrary: () => string;
    tapDataset: () => string;
    tapQuery: () => string;
    nameLabel: () => string;
    nameHelp: () => string;
    descriptionLabel: () => string;
    changesCount: (p: { n: number; count: string }) => string;
    filterSlot: (p: { what: string }) => string;
    quickAddGroup: () => string;
    moreStepsGroup: () => string;
    atEnd: () => string;
    beforeStep: (p: { n: string }) => string;
    stepContext: (p: { n: string }) => string;
    conditionContext: (p: { n: string; c: string }) => string;
    stepFitNote: () => string;
    /** A phone's band of one notice (QP16). */
    dismissNotice: () => string;
    savedNotice: (p: { name: string; time: string }) => string;
    /**
     * A split call, and why — `Split call over orders: it weighs 1.4 GB, more
     * than one piece (16 MB).`; with a dataset cut at the same keys that weighs
     * more, `heaviest` names it (#942).
     */
    planSplit: (p: { over: string; heaviest: string; bytes: string; piece: string }) => string;
    /** The datasets cut at the same keys as the one the pieces work through (#942) — `Prices is cut at the same keys as stock: each piece reads only its own keys of it.` */
    planCopartitioned: (p: { over: string; names: string; n: number }) => string;
    /** A re-keyed join, and why (#942) — `Re-key: both sides large and unaligned — customers weighs more than one piece too.` */
    planRekey: (p: { name: string }) => string;
    /** Its re-key stage, before the join key's jq — `First, orders is re-keyed by this, about 1.4 GB, and each piece then reads customers cut at the same keys:`. */
    planRekeyStage: (p: { over: string; name: string; bytes: string }) => string;
    /** The first rows of a sort, kept in each piece then together (#942), before the key's jq — `The first 10 rows of the sort are kept, each piece's and then theirs together, by:`. */
    planTop: (p: { count: string; n: number }) => string;
    /** A stream's first rows, in input order (#1113), before the `first` or `limit` that keeps them — `The first 3 rows, in input order, are kept: each piece stops once it has 3, and the call once the pieces before the rest have them:`. */
    planFirst: (p: { count: string; n: number }) => string;
    /** One call: it would split over a dataset within one piece — `One call: orders weighs 4 KB, within one piece (16 MB).` */
    planSmall: (p: { over: string; bytes: string; piece: string }) => string;
    /** One call: it would split over a dataset whose weight is not known. */
    planUnweighed: (p: { over: string }) => string;
    /**
     * A split call chosen by its estimates (#1143) — `Split call over orders:
     * estimated faster than one call.`; `Split call over orders: one call
     * would hold more memory than it may use.`; or one a run went on as when
     * its one call's answer was too large for one (#1113).
     */
    planSplitBy: (p: { over: string; why: "time" | "memory" | "size" }) => string;
    /** One call: it would split over a dataset larger than one piece, and one call is estimated no slower (#1143). */
    planFaster: (p: { over: string }) => string;
    /**
     * One call's estimate (#1143) — `As one call: about 17 s, holding about
     * 20 MB.`; with the memory one call may use, whether it is more or within.
     */
    planEstimateOneCall: (p: { seconds: string; peak: string; memory: string | undefined; over: boolean }) => string;
    /**
     * A split call's estimate (#1143) — `As a split call: about 2.9 s, 63
     * pieces, 14 at a time, each holding about 14 MB.`; a re-keyed join's,
     * two calls of as many pieces.
     */
    planEstimateSplit: (p: { rekey: boolean; seconds: string; pieces: string; n: number; cores: string; peak: string }) => string;
    /**
     * What the estimates assumed (#1143) — `Assumed: 29,000,000 rows of
     * orders, each about 1 µs in one call and 1.4 µs in a piece.`; for a
     * stream's first rows, the rows both paths read before they stop
     * (`first`, #1113); and, when one call holds every row, what it holds of
     * each.
     */
    planAssumed: (p: {
        rows: string; n: number; over: string; first: { count: string; n: number } | undefined; oneCall: string; piece: string; held: string | undefined;
    }) => string;
    /** One call: it would split, and the split call could not be made — the planner's message. */
    planUnsplit: (p: { message: string }) => string;
    /**
     * One call, for the reason the query runs as one unit; `name` the
     * builtin or the data source the reason names; `at` whether the jq it is
     * about follows.
     */
    planWhole: (p: { code: PlanWholeCode; name: string | undefined; at: boolean }) => string;
    /** What each piece runs, before its jq — `Each piece of orders runs:`. */
    planPiece: (p: { over: string }) => string;
    /** How the pieces' outputs combine, by kind — a key's, a total's or the step's jq following where it ends with a colon. */
    planCombine: (p: { kind: PlanCombineKind }) => string;
    /** A total's rule, before its jq — `Added up:`. */
    planTotal: (p: { rule: PlanTotalRule }) => string;
    /** What runs once after the combine, before its jq. */
    planThen: () => string;
    /** The data sources every piece reads whole — `Every piece reads customers whole.` */
    planBroadcast: (p: { names: string }) => string;
    /** The pieces and what they weigh, once known — `orders is cut into 12 pieces, about 120 MB each.` */
    planPieces: (p: { over: string; count: string; n: number; size: string }) => string;
    /** How many pieces, for the read-out — `12 pieces`. */
    planPieceCount: (p: { count: string; n: number }) => string;
    /** How many of a split call's units the cache served, for the read-out (#1105) — `11 units cached`; `all cached` for a call it served whole. */
    planCachedCount: (p: { count: string; n: number; whole: boolean }) => string;
    /**
     * How a split call's units ran, once it answered (#1105) — `The cache
     * served 11 of its 14 units, and 3 ran.`; `The cache served the whole
     * call: no unit ran.`; `All 14 of its units ran: the cache held none.`
     */
    planUnits: (p: { kind: "whole" | "some" | "none"; cached: string; ran: string; units: string; n: number }) => string;
    /** How far a split run has got — `3 of 12 pieces done`, `1 of 3 merges done`. */
    planProgress: (p: { phase: "partition" | "merge" | "combine"; done: string; units: string; n: number }) => string;
    /** A read that skips what it doesn't need, before its jq — `Reads the count from orders's index, and no segment:`. */
    planPruning: (p: { kind: "count" | "seek" | "stop"; name: string }) => string;

    // ── Results: the Table (#938) ────────────────────────────────────────
    /** The header of a result's one column, when the result is not records. */
    resultValue: () => string;
    /** A missing value in a result's cell. */
    resultMissing: () => string;
    /** A list in a result's cell, by its size — `3 lines`, `1 line`; the noun already in the count's number. */
    resultList: (p: { count: string; noun: string }) => string;
    /** A lookup table in a result's cell, by its size — `1 entry`, `8 entries`. */
    resultEntries: (p: { count: string; n: number }) => string;
    /** A grid of numbers in a result's cell, by its shape — `3 × 4`. */
    resultGrid: (p: { rows: string; cols: string }) => string;
    /** The parts of a record or a case in a result's cell, joined — `shipped · Jun 1, 2026, 14:00`. */
    resultJoin: (p: { parts: readonly string[] }) => string;
    /** A calculation in a result's cell. */
    resultFunction: () => string;

    // ── The Datasets and Library tabs (#939) ─────────────────────────────
    /** A group of the Datasets tab, by its data sources' kind. */
    datasetGroup: (p: { kind: "rows" | "lookups" | "values" | "models" }) => string;
    /** What the Datasets tab lists, for its search — `data source`, `data sources`. */
    dataSourceNoun: (p: { n: number }) => string;
    /** A data source of rows, counted — `40 orders`; the noun already in the count's number. */
    sourceRows: (p: { count: string; noun: string }) => string;
    /** A lookup table, counted — `8 customers by ID`; the noun already in the count's number. */
    sourceLookup: (p: { count: string; noun: string }) => string;
    /** A tree, uncounted. */
    sourceTree: () => string;
    /** A record. */
    sourceRecord: () => string;
    /** A calculation, by its inputs and what it gives — `price, region → number`. */
    sourceModel: (p: { inputs: string; output: string }) => string;
    /** A data source's size, then its hash when it is known — `40 orders · #4f2a1c8d`. */
    sourceMeta: (p: { size: string; hash: string | undefined }) => string;
    /** What the open query reads a data source as — Source, Looked up. */
    sourceRole: (p: { role: "source" | "lookedUp" }) => string;
    /** What the Library tab lists, for its search — `query`, `queries`. */
    savedNoun: (p: { n: number }) => string;
    /** The Library tab's group of this viewer's recent runs. */
    recentGroup: () => string;
    /** The notice after a query is started on a data source — `Started a new query on customers.` */
    startedOn: (p: { name: string }) => string;
    /** The notice after a query is opened from the Library tab — `Opened “Big orders” from the library.` */
    openedFromLibrary: (p: { name: string }) => string;
    /** The notice after a query library's card is dropped on the builder — `Opened “Big orders” from the query library.` */
    openedFromQueryLibrary: (p: { name: string }) => string;
    /** The notice after the builder's host opens a query in it — `Opened “Big orders”.` */
    opened: (p: { name: string }) => string;

    // ── Dropping (#939) ──────────────────────────────────────────────────
    /** Over the builder while a query library's card rests on it — `Drop to open “Revenue by region”`. */
    dropToOpen: (p: { name: string }) => string;
    /** Under it: how many steps that query has — `5 steps.` */
    dropSteps: (p: { count: string; n: number }) => string;
    /** The builder, as the drag layer names it in what it says — `Revenue by region is over the query builder.` */
    dropTargetName: () => string;
    /** The builder refusing a card, as the drag layer names it, with why — `the query builder (Reads customers, which isn't here) does not take Big orders.` */
    dropRefusedName: (p: { reason: string }) => string;

    // ── The query library (#1063) ────────────────────────────────────────
    /** Its search's placeholder — `Search 7 queries…`. */
    librarySearch: (p: { count: string; n: number }) => string;
    /** Its search's accessible name. */
    librarySearchLabel: () => string;
    /** Clears the search. */
    clearSearch: () => string;
    /** Sort, by the order it shows — `Sort · Recent`. */
    librarySort: (p: { sort: "recent" | "name" }) => string;
    /** An order in Sort's menu. */
    librarySortOption: (p: { sort: "recent" | "name" }) => string;
    /** The primary action — `New query on orders`. */
    newQueryOn: (p: { source: string }) => string;
    /** It, folded. */
    newQuery: () => string;
    /** The pane's caption. */
    dataSources: () => string;
    /** The pane's first row: every saved query. */
    allQueries: () => string;
    /** A card's action. */
    openInBuilder: () => string;
    /**
     * A card's byline — `orders · 5 steps · up to 10 shipped orders · saved
     * Tue`: what it starts from, its steps (none for a program that is not
     * steps), what it gives or its problems, and when it was saved — or, for a
     * recent run, ran.
     */
    libraryByline: (p: { source: string; steps: { count: string; n: number } | undefined; gives: string; when: string; run: boolean }) => string;
    /** A wireframe's last line, for the steps it leaves out — `+2 more`. */
    moreSteps: (p: { count: string; n: number }) => string;
    /** A wireframe's line for a program that is not steps. */
    jqProgram: () => string;
    /** The gallery when nothing matches the search — `No queries match “sku”`. */
    noMatch: (p: { text: string }) => string;
    /** Under it. */
    checkSpelling: () => string;
    /** Under it, while the pane shows a data source or Recent. */
    clearFilter: () => string;
    /** Under it, while the pane shows every query. */
    searchWhat: () => string;
    /** No saved queries — on the data source shown, or at all. */
    noQueries: () => string;
    /** Under it. */
    saveInBuilder: () => string;
    /** No recent runs. */
    noRecent: () => string;
    /** Under it. */
    runInBuilder: () => string;
}

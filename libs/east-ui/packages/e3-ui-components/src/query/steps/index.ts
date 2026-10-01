/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's canonical steps (#933): the step algebra behind the
 * builder, with no rendering in it — steps printed as canonical jq and parsed
 * back, checked with every diagnostic on its step, condition and slot, edited,
 * and counted. The builder and the query library import it; the package's
 * index does not export it.
 *
 * @packageDocumentation
 */

export {
    comparison, freshId, isComplete, isConditionComplete, isGiven, needsValue,
    type Aggregate, type Comparison, type ComparisonKind, type Condition, type GroupCondition, type IdKind, type Match, type PickField,
    type Step, type StepInput, type StepKind, type StepOf, type StepQuery, type StepValue, type TestCondition,
} from "./values.js";
export { UNKNOWN, baseType, optionPayload, orMissing, rowOf, shapeOf, singular, unwrapRecursive, type Shape, type ShapeKind } from "./shape.js";
export {
    comparisonsFor, defaultComparison, fieldByRef, fieldsOf, fieldsOfRecord, itemRecordOf, kindOf, pathOfUnknown,
    type FieldKind, type StepField,
} from "./fields.js";
export {
    itemShape, layOutSteps, printSteps,
    type ConditionRange, type LaidOutSegment, type LaidOutStep, type PrintedSteps, type SlotRange, type StepLayout, type StepRange, type StepSlot,
} from "./print.js";
export { defaultTotalName, parseSteps, type StepParseError } from "./parse.js";
export { checkSteps, type CheckedStepStage, type CheckedSteps, type DiagnosticSlot, type StepDiagnostic, type StepFix } from "./check.js";
export {
    addCondition, addGroup, applyFix, emptyCondition, insertStep, moveStep, newStep, removeCondition, removeStep, setConditionField,
    setConditionValue, setMatch, updateStep,
} from "./edit.js";
export { DEFAULT_MAX_ROWS, SOURCE_COUNT, countingProgram, readCounts, type CountingProgram } from "./count.js";

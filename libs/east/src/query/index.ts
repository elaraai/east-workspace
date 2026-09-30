/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
export {
  JqPatternType, JqType,
  QueryMultiplicityType, QueryV1Type, QueryType, QueryCallType,
  QuerySpanType, QueryEditType, QueryFixType, QueryErrorType,
} from "./types.js";
export { QueryError, evaluateJq, type EvaluateJqOptions, type QueryDiagnostic } from "./evaluate.js";
export { translateJq, TranslationError, type JqTranslation, type TranslateJqOptions } from "./jq/translate.js";
export { lexJq, type JqToken, type JqTokenKind } from "./jq/lex.js";
export { parseJq, type ParsedJq } from "./jq/parse.js";
export { printJq, type PrintJqOptions, type PrintedJq } from "./jq/print.js";
export { pathAt, spanOf, toQuerySpan, type JqNode, type JqPattern, type JqRange, type JqSpans } from "./jq/spans.js";
export {
  checkJq, type CheckJqOptions, type CheckJqResult, type CheckedNode, type CheckedStage, type JqMultiplicity,
} from "./jq/check.js";
export { describeJqType, plainKind } from "./jq/describe.js";
export { SummaryLeafType, SummaryType, summaryProgram, type SummaryProgramOptions } from "./jq/summary.js";
export { completeJq, type CompleteJqOptions, type JqCompletion, type JqCompletionKind, type JqCompletions } from "./jq/complete.js";

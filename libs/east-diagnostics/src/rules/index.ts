/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";
import { noRedundantEastCast } from "./no-redundant-east-cast.js";
import { preferExplicitEastType } from "./prefer-explicit-east-type.js";
import { preferSomeNone } from "./prefer-some-none.js";
import { noHandrolledVariant } from "./no-handrolled-variant.js";
import { noEastNamespacedType } from "./no-east-namespaced-type.js";
import { preferLetConstOverEastValue } from "./prefer-let-const-over-east-value.js";
import { noRelativeSrcImport } from "./no-relative-src-import.js";
import { noLetConstInExpression } from "./no-let-const-in-expression.js";
import { noUnexecutedEastExpression } from "./no-unexecuted-east-expression.js";
import { noReinlinedEastBinding } from "./no-reinlined-east-binding.js";
import { preferJsxOverFactoryCall } from "./prefer-jsx-over-factory-call.js";
import { noUntrackedEastData } from "./no-untracked-east-data.js";
import { noCompileTimeDataInjection } from "./no-compile-time-data-injection.js";
import { noCompileTimeSeedData } from "./no-compile-time-seed-data.js";
import { noHostInEastBlock } from "./no-host-in-east-block.js";
import { noModuleScopeEastMacro } from "./no-module-scope-east-macro.js";
import { requireRunnerPlatforms } from "./require-runner-platforms.js";
import { noCrossBlockBuilder } from "./no-cross-block-builder.js";
import { noStateOutsideReactive } from "./no-state-outside-reactive.js";
import { preferConstUiCallbacks } from "./prefer-const-ui-callbacks.js";
import { noDynamicBindPath } from "./no-dynamic-bind-path.js";
import { noBuildTimeClock } from "./no-build-time-clock.js";
import { noHandrolledValueTypeMirror } from "./no-handrolled-value-type-mirror.js";
import { noHostComparisonOnEastValues } from "./no-host-comparison-on-east-values.js";
import { requireExampleReturns } from "./require-example-returns.js";
import { noDuplicateDefinitionName } from "./no-duplicate-definition-name.js";

export { noRedundantEastCast } from "./no-redundant-east-cast.js";
export { preferExplicitEastType } from "./prefer-explicit-east-type.js";
export { preferSomeNone } from "./prefer-some-none.js";
export { noHandrolledVariant } from "./no-handrolled-variant.js";
export { noEastNamespacedType } from "./no-east-namespaced-type.js";
export { preferLetConstOverEastValue } from "./prefer-let-const-over-east-value.js";
export { noRelativeSrcImport } from "./no-relative-src-import.js";
export { noLetConstInExpression } from "./no-let-const-in-expression.js";
export { noUnexecutedEastExpression } from "./no-unexecuted-east-expression.js";
export { noReinlinedEastBinding } from "./no-reinlined-east-binding.js";
export { preferJsxOverFactoryCall } from "./prefer-jsx-over-factory-call.js";
export { noUntrackedEastData } from "./no-untracked-east-data.js";
export { noCompileTimeDataInjection } from "./no-compile-time-data-injection.js";
export { noCompileTimeSeedData } from "./no-compile-time-seed-data.js";
export { noHostInEastBlock } from "./no-host-in-east-block.js";
export { noModuleScopeEastMacro } from "./no-module-scope-east-macro.js";
export { requireRunnerPlatforms } from "./require-runner-platforms.js";
export { noCrossBlockBuilder } from "./no-cross-block-builder.js";
export { noStateOutsideReactive } from "./no-state-outside-reactive.js";
export { preferConstUiCallbacks } from "./prefer-const-ui-callbacks.js";
export { noDynamicBindPath } from "./no-dynamic-bind-path.js";
export { noBuildTimeClock } from "./no-build-time-clock.js";
export { noHandrolledValueTypeMirror } from "./no-handrolled-value-type-mirror.js";
export { noHostComparisonOnEastValues } from "./no-host-comparison-on-east-values.js";
export { requireExampleReturns } from "./require-example-returns.js";
export { noDuplicateDefinitionName } from "./no-duplicate-definition-name.js";

export const allRules: readonly EastRule[] = [
  // East-side idiom hygiene (original set)
  noRedundantEastCast,
  preferExplicitEastType,
  preferSomeNone,
  noHandrolledVariant,
  noEastNamespacedType,
  preferLetConstOverEastValue,
  noRelativeSrcImport,
  noLetConstInExpression,
  noUnexecutedEastExpression,
  noReinlinedEastBinding,
  preferJsxOverFactoryCall,
  noUntrackedEastData,
  // host-vs-East family: the general block rule + the module-scope macro rule,
  // plus the separate build-time-data concerns (ingestion primitives, and
  // host-computed e3.input seed data)
  noHostInEastBlock,
  noModuleScopeEastMacro,
  noCompileTimeDataInjection,
  noCompileTimeSeedData,
  // deploy/runtime-failure classes that type-check clean (epic #208)
  requireRunnerPlatforms,
  noCrossBlockBuilder,
  noStateOutsideReactive,
  preferConstUiCallbacks,
  noDynamicBindPath,
  noBuildTimeClock,
  noHandrolledValueTypeMirror,
  noHostComparisonOnEastValues,
  requireExampleReturns,
  noDuplicateDefinitionName,
];

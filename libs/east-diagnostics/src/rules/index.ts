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
import { noEastDataBuilderHelper } from "./no-east-data-builder-helper.js";
import { preferJsxOverFactoryCall } from "./prefer-jsx-over-factory-call.js";
import { noUntrackedEastData } from "./no-untracked-east-data.js";

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
export { noEastDataBuilderHelper } from "./no-east-data-builder-helper.js";
export { preferJsxOverFactoryCall } from "./prefer-jsx-over-factory-call.js";
export { noUntrackedEastData } from "./no-untracked-east-data.js";

export const allRules: readonly EastRule[] = [
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
  noEastDataBuilderHelper,
  preferJsxOverFactoryCall,
  noUntrackedEastData,
];

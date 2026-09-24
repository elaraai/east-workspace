/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { equalFor, greaterEqualFor, greaterFor, isFor, lessEqualFor, lessFor, notEqualFor } from "../../comparison.js";
import type { BuiltinEvaluators } from "../runtime.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import { applyFor } from "../../patch/apply.js";
import { composeFor } from "../../patch/compose.js";
import { diffFor } from "../../patch/diff.js";
import { ConflictError } from "../../patch/index.js";
import { invertFor } from "../../patch/invert.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for comparisons and patches. @internal */
export const compare_builtins = {
  Is: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => isFor(T),
  Equal: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => equalFor(T),
  NotEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => notEqualFor(T),
  Less: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => lessFor(T),
  LessEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => lessEqualFor(T),
  Greater: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => greaterFor(T),
  GreaterEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => greaterEqualFor(T),
  Diff: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => diffFor(T),
  ApplyPatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const apply = applyFor(T);
    return (base: any, patch: any) => {
      try {
        return apply(base, patch);
      } catch (e) {
        if (e instanceof ConflictError) {
          throw new EastError(e.message, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        throw e;
      }
    };
  },
  ComposePatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const compose = composeFor(T);
    return (first: any, second: any) => {
      try {
        return compose(first, second);
      } catch (e) {
        if (e instanceof ConflictError) {
          throw new EastError(e.message, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        throw e;
      }
    };
  },
  InvertPatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => invertFor(T),
} satisfies BuiltinEvaluators;

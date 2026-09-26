/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinEvaluators, call_function, FROZEN_MESSAGE } from "../runtime.js";
import { ref } from "../../containers/ref.js";
import { EastError } from "../../error.js";
import { isFrozenValue } from "../../frozen.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Refs. @internal */
export const ref_builtins = {
  RefGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>) => {
    return ref.value;
  },
  RefUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>, value: any) => {
    if (isFrozenValue(ref)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    ref.value = value;
    return null;
  },
  RefMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>, value: any, merger: (existing: any, value: any) => any) => {
    if (isFrozenValue(ref)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const new_value = call_function(loc_id, source_map,merger, ref.value, value);
    ref.value = new_value;
    return null;
  },
} satisfies BuiltinEvaluators;

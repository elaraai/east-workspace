/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { variant } from "../containers/variant.js";
import type { EastTypeValue } from "../type_of_type.js";

/** @internal */
export function applyTypeParameters(t: EastTypeValue | string, params: Map<string, EastTypeValue>): EastTypeValue {
  if (typeof(t) === "string") {
    let ret = params.get(t);
    if (ret === undefined) {
      throw new Error(`Unable to find type parameter ${JSON.stringify(t)}`);
    }
    return ret;
  } else if (t.type === "Null" || t.type === "Boolean" || t.type === "Integer" || t.type === "Float" || t.type === "String" || t.type === "DateTime" || t.type ==="Blob" || t.type === "Never") {
    return t;
  } else if (t.type === "Ref") {
    return variant("Ref", applyTypeParameters(t.value, params));
  } else if (t.type === "Array") {
    return variant("Array", applyTypeParameters(t.value, params));
  } else if (t.type === "Set") {
    return variant("Set", applyTypeParameters(t.value, params));
  } else if (t.type === "Dict") {
    return variant("Dict", { key: applyTypeParameters(t.value.key, params), value: applyTypeParameters(t.value.value, params) });
  } else if (t.type === "Struct") {
    return variant("Struct", t.value.map(({ name, type }) => ({ name, type: applyTypeParameters(type, params) })));
  } else if (t.type === "Variant") {
    return variant("Variant", t.value.map(({ name, type }) => ({ name, type: applyTypeParameters(type, params) })));
  } else if (t.type === "Recursive") {
    return t;
  } else if (t.type === "Function") {
    return variant("Function", { inputs: t.value.inputs.map(i => applyTypeParameters(i, params)), output: applyTypeParameters(t.value.output, params) } );
  } else if (t.type === "AsyncFunction") {
    return variant("AsyncFunction", { inputs: t.value.inputs.map(i => applyTypeParameters(i, params)), output: applyTypeParameters(t.value.output, params) } );
  } else if (t.type === "Vector") {
    return variant("Vector", applyTypeParameters(t.value, params));
  } else if (t.type === "Matrix") {
    return variant("Matrix", applyTypeParameters(t.value, params));
  } else {
    throw new Error(`Unhandled type ${((t satisfies never) as EastTypeValue).type}`)
  }
}

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * A record the record runtime's tests bind beside the Record.bind examples,
 * on no page of the showcase: an outline whose state is a tree, so its patch
 * door's argument is a recursive type. A recursive type's wrappers are
 * numbered by the process that built it, so the signature of a package another
 * process exported names the type with ids a binding's do not share.
 *
 * @packageDocumentation
 */

import { ArrayType, DictType, RecursiveType, StringType, StructType, type ValueTypeOf } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

/** A heading of an outline, with the headings under it. */
export const Heading = RecursiveType((self) => StructType({ title: StringType, children: ArrayType(self) }));

/** A heading, as TypeScript holds it. */
export type HeadingValue = ValueTypeOf<typeof Heading>;

/** An outline's headings by key, one heading with none under it to start: a record whose state is a tree, written through its patch door. */
export const outline = e3.record("outline", DictType(StringType, Heading), {
    initial: new Map([["intro", { title: "Intro", children: [] }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a filter change may cost a builder (#1354), as its tests count it: each
 * run of its Reactive root's body, which builds the builder again, and each
 * payload its extension decodes. A body that runs again over the same handles
 * writes the same bytes, which the dispatcher keeps without decoding them, so
 * a decode count alone misses a builder built again for nothing.
 *
 * @packageDocumentation
 */

import { vi } from "vitest";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { getExtensionEntry } from "@elaraai/east-ui-components";

/** A compiled UI program: what a harness mounts. */
export type UIProgram = () => ValueTypeOf<typeof UIComponentType>;

/** A builder's builds, counted over a program whose UI is a Reactive root. */
export interface Builds {
    /** The program to mount: the given one, its root's body counted each time it runs. */
    program: UIProgram;
    /** The root's body's runs so far. */
    readonly runs: number;
    /** The payloads the builder's extension has decoded so far. */
    readonly decodes: number;
    /** Puts the extension's decode back. */
    restore(): void;
}

/**
 * Counts a builder's builds: its Reactive root's body's runs, and its
 * extension's decodes.
 *
 * @param kind - The builder's extension (`Plan`)
 * @param program - The program, its UI a Reactive root
 * @returns The program to mount and the counts
 */
export function countBuilds(kind: string, program: UIProgram): Builds {
    const entry = getExtensionEntry(kind);
    if (entry === undefined) throw new Error(`no ${kind} extension is registered`);
    const decode = vi.spyOn(entry, "decode");
    let runs = 0;
    const counted: UIProgram = () => {
        const root = program();
        if (root.type !== "ReactiveComponent") throw new Error("the program's UI is no Reactive root");
        const render = root.value.render;
        return variant("ReactiveComponent", { ...root.value, render: () => { runs += 1; return render(); } });
    };
    return {
        program: counted,
        get runs() { return runs; },
        get decodes() { return decode.mock.calls.length; },
        restore() { decode.mockRestore(); },
    };
}

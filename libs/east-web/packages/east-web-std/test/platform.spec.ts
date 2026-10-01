/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The browser platform is east-node-std's, less what a browser has no meaning
 * for: every function it gives has east-node-std's name, input and output
 * types and kind, so an East program written for Node compiles against it
 * unchanged; FileSystem, Env and the JSON reader are all that is missing, and
 * a program that calls one of them fails naming it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { East, NullType, OptionType, StringType, isTypeValueEqual } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EnvImpl, FileSystemImpl, JsonImpl, NodePlatform, env_get, fs_read_file, json_open } from "@elaraai/east-node-std";
import {
    Console, ConsoleImpl, Crypto, CryptoImpl, FetchImpl, Path, PathImpl, RandomImpl, TestImpl, Time, TimeImpl,
    WebPlatform, createWebPlatform,
} from "@elaraai/east-web-std";
import { captureConsole, nodeTestHost } from "./support.js";

/** A platform's functions by name. */
function byName(platform: readonly PlatformFunction[]): Map<string, PlatformFunction> {
    return new Map(platform.map(fn => [fn.name, fn]));
}

/** The names a platform gives, in order. */
const names = (platform: readonly PlatformFunction[]): string[] => platform.map(fn => fn.name);

/** Where two declarations of one platform function differ, if they do. */
function differences(web: PlatformFunction, node: PlatformFunction): string[] {
    const found: string[] = [];
    if (web.type !== node.type) found.push(`${web.name} is ${web.type} here and ${node.type} on Node`);
    if (web.inputs.length !== node.inputs.length) {
        found.push(`${web.name} takes ${web.inputs.length} inputs here and ${node.inputs.length} on Node`);
    } else {
        web.inputs.forEach((input, i) => {
            if (!isTypeValueEqual(input, node.inputs[i]!)) found.push(`${web.name}'s input ${i} differs from Node's`);
        });
    }
    if (!isTypeValueEqual(web.output, node.output)) found.push(`${web.name}'s output differs from Node's`);
    if ((web.type_parameters ?? []).length !== 0 || (node.type_parameters ?? []).length !== 0) {
        found.push(`${web.name} is generic, which this check does not compare`);
    }
    return found;
}

describe("the browser platform", () => {
    it("gives every function east-node-std gives but FileSystem's, Env's and Json's", () => {
        const web = byName(WebPlatform);
        const node = byName(NodePlatform);
        const missing = [...node.keys()].filter(name => !web.has(name)).sort();
        const leftOut = names([...FileSystemImpl, ...EnvImpl, ...JsonImpl]).sort();
        assert.deepEqual(missing, leftOut);
        assert.deepEqual([...web.keys()].filter(name => !node.has(name)), [], "a function east-node-std does not give is not portable");
    });

    it("declares each function with east-node-std's inputs, output and kind", () => {
        const node = byName(NodePlatform);
        const found = WebPlatform.flatMap(fn => differences(fn, node.get(fn.name)!));
        assert.deepEqual(found, []);
    });

    it("holds each function once", () => {
        for (const platform of [WebPlatform, createWebPlatform(), createWebPlatform({ console: captureConsole(), test: nodeTestHost })]) {
            const all = names(platform);
            assert.deepEqual(all.filter((name, i) => all.indexOf(name) !== i), []);
        }
    });

    it("is the modules' implementations, in east-node-std's order", () => {
        assert.deepEqual(
            names(WebPlatform),
            names([...ConsoleImpl, ...PathImpl, ...CryptoImpl, ...TimeImpl, ...FetchImpl, ...RandomImpl, ...TestImpl]),
        );
    });

    it("gives the same functions from createWebPlatform, with the host's console and tests", () => {
        const created = createWebPlatform({ console: captureConsole(), test: nodeTestHost });
        assert.deepEqual(names(created), names(WebPlatform));
        const node = byName(NodePlatform);
        assert.deepEqual(created.flatMap(fn => differences(fn, node.get(fn.name)!)), []);
    });

    it("fails to compile a program that calls FileSystem, naming the function", () => {
        const read = East.function([StringType], StringType, ($, path) => fs_read_file(path));
        assert.throws(() => read.toIR().compile(WebPlatform), /Platform function 'fs_read_file' not found/);
    });

    it("fails to compile a program that calls Env, naming the function", () => {
        const token = East.function([], OptionType(StringType), _$ => env_get("API_TOKEN"));
        assert.throws(() => token.toIR().compile(WebPlatform), /Platform function 'env_get' not found/);
    });

    it("fails to compile a program that calls the JSON reader, naming the function", () => {
        const open = East.function([StringType], StringType, ($, path) => json_open(path, ""));
        assert.throws(() => open.toIR().compile(WebPlatform), /Platform function 'json_open' not found/);
    });

    it("runs a program written for Node, writing to the host's console", async () => {
        const sink = captureConsole();
        const program = East.asyncFunction([], NullType, $ => {
            $(Console.log(Path.join(["reports", "..", "data", "rows.csv"])));
            $(Console.error(Crypto.hashSha256("abc")));
            $(Time.sleep(1n));
        });
        await program.toIR().compile(createWebPlatform({ console: sink }))();
        assert.deepEqual(sink.out, ["data/rows.csv\n"]);
        assert.deepEqual(sink.err, ["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n"]);
    });
});

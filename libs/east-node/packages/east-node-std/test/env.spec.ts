/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, Env, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./env.examples.js";

// NOTE: this suite's IR is exported and re-run against other runtimes'
// platform implementations (east-py-std), so every test must hold in ANY
// process environment — assert only on PATH (always set) and on a sentinel
// variable nothing sets.
describeEast("Env platform functions", (test) => {
    Assert.examples(test, { envGet: ex.envGet });

    test("get returns some for a set variable", $ => {
        const path = $.let(Env.get("PATH"));
        $(Assert.equal(path.hasTag("some"), true));
    });

    test("get returns a non-empty value for PATH", $ => {
        const value = $.let(Env.get("PATH").unwrap());
        $(Assert.notEqual(value, ""));
    });

    test("get returns none for an unset variable", $ => {
        const missing = $.let(Env.get("EAST_TEST_SURELY_UNSET_VARIABLE_8371"));
        $(Assert.equal(missing.hasTag("none"), true));
    });

    test("unwrap with a fallback covers the unset case", $ => {
        const value = $.let(Env.get("EAST_TEST_SURELY_UNSET_VARIABLE_8371").unwrap("some", _$ => "fallback"));
        $(Assert.equal(value, "fallback"));
    });
}, { platformFns: NodePlatform });

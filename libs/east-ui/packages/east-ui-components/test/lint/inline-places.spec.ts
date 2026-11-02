/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-ui/inline-places` (#1440): each case of the fixture, and what the
 * rule says of it — a Chakra style prop composed from numbers refused, in
 * place, through a local, a helper, a spread, a `css` object and a
 * condition; a literal, a constant and a template of one, a token and one
 * built from a string, a number passed through whole or unwrapped by a
 * helper, a choice between literals, an inline style, a component's own prop
 * and an element's own attribute left alone.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { composedStyleProps } from "../../eslint/inline-places.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "places.tsx");

test("east-ui/inline-places refuses a Chakra style prop composed from numbers, and nothing else", () => {
    const config = ts.getParsedCommandLineOfConfigFile(path.join(here, "..", "..", "tsconfig.typecheck.json"), {}, {
        ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
    })!;
    const program = ts.createProgram({ rootNames: [fixture], options: { ...config.options, noEmit: true } });
    const source = program.getSourceFile(fixture)!;
    const said = composedStyleProps(source, program.getTypeChecker())
        .map((place) => `${source.getLineAndCharacterOfPosition(place.start).line + 1} ${place.prop}`);
    const line = (text: string) => source.text.split("\n").findIndex((l) => l.includes(text)) + 1;
    assert.deepEqual(said, [
        `${line("<Box left={`${f * 100}%`} />")} left`,
        `${line("<Box width={n * 2} />")} width`,
        `${line("<Box height={Math.round(n)} />")} height`,
        `${line("<Box left={scale.fracOf(n)} />")} left`,
        `${line("<Box left={left} />")} left`,
        `${line("<Box paddingLeft={step(n)} />")} paddingLeft`,
        `${line("<Box {...place(f)} />")} left`,
        `${line("<Box css={{ top:")} top`,
        `${line("<Box _hover={{ left:")} _hover`,
    ]);
});

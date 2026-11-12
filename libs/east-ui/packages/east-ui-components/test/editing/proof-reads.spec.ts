/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the editing core's proof reads (#1599), held to what its harness
 * loads. `src/editing/model/proof.json` names it, by paths from the
 * checkout's root: `reads`, this package's files the harness loads, and
 * `runsOn`, what the proof is run on beside them. The proof's workflow
 * (`.github/workflows/proof-editing.yml`) keys a proof that passed by the
 * content of both, and holds a pull request that changes one of `reads` to
 * the proof. A file the harness came to load that the list left out would be
 * changed with no proof asked, and a proof made before the change would stand
 * for it still.
 *
 * What the harness loads is every module its test files and the package's
 * Vitest setup import, and those import in turn. Under this package's
 * `verbatimModuleSyntax` an import is kept as it is written, so a module is
 * loaded by every import and re-export of it but an `import type` or an
 * `export type` declaration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..", "..");
const repo = path.join(pkg, "..", "..", "..", "..");
const model = path.join(pkg, "src", "editing", "model");

/** What the proof reads, as its workflow reads it. */
interface ProofReads {
    /** This package's files the harness loads: a folder, or a file. */
    readonly reads: readonly string[];
    /** What the proof is run on beside them. */
    readonly runsOn: readonly string[];
}

const proof = JSON.parse(fs.readFileSync(path.join(model, "proof.json"), "utf8")) as ProofReads;

/** A path as `proof.json` writes it: from the checkout's root, with forward slashes. */
function named(file: string): string {
    return path.relative(repo, file).split(path.sep).join("/");
}

/** Whether a list names a path: the path itself, or a folder that holds it. */
function names(list: readonly string[], file: string): boolean {
    return list.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/** The modules a source file loads, as it names them: every import and re-export it makes but those of types alone. */
function loadedBy(file: string): string[] {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
    const types = new Set<string>();
    const values = new Set<string>();
    for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ? types : values).add(statement.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
            (statement.isTypeOnly ? types : values).add(statement.moduleSpecifier.text);
        }
    }
    // Whatever else names a module loads it: an import called as the file runs.
    return ts.preProcessFile(text, true, true).importedFiles.map((imported) => imported.fileName)
        .filter((name) => values.has(name) || !types.has(name));
}

/** The file a relative import names. */
function fileOf(from: string, name: string): string {
    const base = path.resolve(path.dirname(from), name);
    const bare = base.replace(/\.js$/, "");
    const found = [`${bare}.ts`, `${bare}.tsx`, base, path.join(base, "index.ts"), path.join(base, "index.tsx")]
        .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(found !== undefined, `${named(from)} imports ${name}, which is no file`);
    return found;
}

/** What the harness loads: this package's files, and the packages it loads beside them. */
function harness(): { files: string[]; packages: string[] } {
    const roots = fs.readdirSync(model).filter((name) => name.endsWith(".test.ts")).map((name) => path.join(model, name));
    assert.ok(roots.length > 0, "the harness has test files");
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [...roots, path.join(pkg, "vitest.setup.ts")];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (files.has(file)) continue;
        files.add(file);
        for (const name of loadedBy(file)) {
            if (name.startsWith(".")) queue.push(fileOf(file, name));
            else packages.add(name);
        }
    }
    return { files: [...files].map(named).sort(), packages: [...packages].sort() };
}

test("every file the editing core's proof loads from this package is one its workflow keys the proof by", () => {
    const { files } = harness();
    assert.deepEqual(files.filter((file) => !names([...proof.reads, ...proof.runsOn], file)), [],
        "add each to `reads` in src/editing/model/proof.json: a change to it is then held to the proof, and runs it again");
});

test("and it names no file of this package's that the proof does not load", () => {
    const { files } = harness();
    assert.deepEqual(proof.reads.filter((entry) => !files.some((file) => names([entry], file))), [],
        "take each out of `reads` in src/editing/model/proof.json: a change to it would be held to a proof that reads none of it");
});

test("every workspace package the proof loads is one it is run again for", () => {
    const { packages } = harness();
    const sources = packages.filter((name) => name.startsWith("@elaraai/"))
        .map((name) => `${named(fs.realpathSync(path.join(pkg, "node_modules", ...name.split("/").slice(0, 2))))}/src`);
    assert.ok(sources.length > 0, "the harness loads East");
    assert.deepEqual([...new Set(sources)].filter((source) => !proof.runsOn.includes(source)), [],
        "add each to `runsOn` in src/editing/model/proof.json");
});

test("every path it names is in the checkout", () => {
    assert.deepEqual([...proof.reads, ...proof.runsOn].filter((entry) => !fs.existsSync(path.join(repo, entry))), []);
});

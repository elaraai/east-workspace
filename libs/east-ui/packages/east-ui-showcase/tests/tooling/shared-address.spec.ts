/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The page's address sharing its e3 with the other tabs of a set
 * (`?shared`, `?shared=<set>`): the set's name, as the page reads it, and the
 * workspace the set reads an area from — the set's, and the bundle's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOWCASE_REPO, sharedE3Repo, sharedE3Workspace, sharedSetFromAddress, showcaseE3Workspace } from "../../showcase-config";

test("an address's set of shared tabs: its name's letters and digits, lower case, `1` alone, and none without it", () => {
    assert.equal(sharedSetFromAddress("?shared"), "1");
    assert.equal(sharedSetFromAddress("?shared="), "1");
    assert.equal(sharedSetFromAddress("?theme=dark&shared=Round-2"), "round2");
    for (const search of ["", "?theme=dark", "?slow=600"]) assert.equal(sharedSetFromAddress(search), undefined, search);
});

test("a set reads an area from a workspace of its own, of the bundle it was made from", () => {
    const one = sharedE3Workspace("sheet", "1", "/assets/e3/sheet-a1b2.beast2");
    assert.match(one, /^sheet-shared-1-[0-9a-z]+$/);
    assert.notEqual(one, showcaseE3Workspace("sheet"));
    assert.equal(sharedE3Workspace("sheet", "1", "/assets/e3/sheet-a1b2.beast2"), one);
    assert.notEqual(sharedE3Workspace("sheet", "2", "/assets/e3/sheet-a1b2.beast2"), one);
    assert.notEqual(sharedE3Workspace("sheet", "1", "/assets/e3/sheet-c3d4.beast2"), one);
});

test("shared tabs keep a repository of the build's bundles: the same for every set of one build, another for a build of other bundles", () => {
    const build = ["/assets/e3/sheet-a1b2.beast2", "/assets/e3/plan-c3d4.beast2"].join("\n");
    const one = sharedE3Repo(build);
    assert.match(one, /^shared-[0-9a-z]+$/);
    assert.notEqual(one, SHOWCASE_REPO);
    assert.equal(sharedE3Repo(build), one);
    assert.notEqual(sharedE3Repo(["/assets/e3/sheet-e5f6.beast2", "/assets/e3/plan-c3d4.beast2"].join("\n")), one);
});

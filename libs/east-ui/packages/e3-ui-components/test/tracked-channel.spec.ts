/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for {@link TrackedChannelStore} — the shared base behind the
 * Func.bind / Record.bind runtimes (latest-wins channels + per-key reactive
 * subscriptions + render tracking). Exercised end-to-end by func-runtime and
 * record-runtime; these tests pin the base contract directly.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TrackedChannelStore } from "../src/platform/tracked-channel.js";

interface TestEntry { status: string; launchSeq: number; value?: number; error?: string }

/** A minimal concrete store exposing the protected surface for testing. */
class TestStore extends TrackedChannelStore<TestEntry> {
    protected createEntry(): TestEntry {
        return { status: "idle", launchSeq: 0 };
    }
    open(key: string, reset?: (e: TestEntry) => void) {
        return this.beginLaunch(key, reset);
    }
    cancel(key: string, after?: (e: TestEntry) => void) {
        this.cancelChannel(key, after);
    }
    statusOf(key: string): string | undefined {
        return this.entryOf(key)?.status;
    }
    entryOf(key: string): TestEntry | undefined {
        return (this as unknown as { entries: Map<string, TestEntry> }).entries.get(key);
    }
    trackKey(key: string) { this.track(key); }
    wipe() { this.clearChannels(); }
}

describe("TrackedChannelStore — subscriptions", () => {
    test("notify on a launch bumps the key version and fires subscribers", () => {
        const store = new TestStore();
        let calls = 0;
        const before = store.getKeyVersion("k");
        const off = store.subscribe("k", () => { calls++; });
        store.open("k");
        assert.equal(calls, 1);
        assert.ok(store.getKeyVersion("k") > before);
        off();
        store.open("k"); // settled subscriber removed → no further calls
        assert.equal(calls, 1);
    });

    test("subscribers are isolated per key", () => {
        const store = new TestStore();
        let a = 0;
        store.subscribe("a", () => { a++; });
        store.open("b");
        assert.equal(a, 0);
    });
});

describe("TrackedChannelStore — render tracking", () => {
    test("enableTracking collects tracked keys; disable returns + clears them", () => {
        const store = new TestStore();
        assert.equal(store.isTracking(), false);
        store.trackKey("ignored-when-not-tracking");
        store.enableTracking();
        assert.equal(store.isTracking(), true);
        store.trackKey("x");
        store.trackKey("y");
        store.trackKey("x"); // de-duped by the Set
        const keys = store.disableTracking();
        assert.deepEqual([...keys].sort(), ["x", "y"]);
        assert.equal(store.isTracking(), false);
    });
});

describe("TrackedChannelStore — latest-wins latch", () => {
    test("a superseded launch's settle is a no-op", () => {
        const store = new TestStore();
        const first = store.open("k");
        const second = store.open("k"); // supersedes `first`
        first.settle(e => { e.status = "succeeded"; e.value = 1; });
        assert.equal(store.statusOf("k"), "running"); // first was dropped
        second.settle(e => { e.status = "succeeded"; e.value = 2; });
        assert.equal(store.statusOf("k"), "succeeded");
        assert.equal(store.entryOf("k")!.value, 2);
    });

    test("beginLaunch runs the reset hook before marking running", () => {
        const store = new TestStore();
        const a = store.open("k");
        a.settle(e => { e.status = "failed"; e.error = "boom"; });
        assert.equal(store.entryOf("k")!.error, "boom");
        store.open("k", e => { delete e.error; }); // reset clears the prior error
        assert.equal(store.entryOf("k")!.error, undefined);
        assert.equal(store.statusOf("k"), "running");
    });
});

describe("TrackedChannelStore — cancel", () => {
    test("cancel orphans the in-flight launch and runs the after-hook", () => {
        const store = new TestStore();
        const launch = store.open("k");
        let afterRan = false;
        store.cancel("k", e => { afterRan = true; e.value = -1; });
        assert.equal(store.statusOf("k"), "cancelled");
        assert.equal(afterRan, true);
        assert.equal(store.entryOf("k")!.value, -1);
        // The cancelled launch can no longer settle.
        launch.settle(e => { e.status = "succeeded"; });
        assert.equal(store.statusOf("k"), "cancelled");
    });

    test("cancel is a no-op when the channel is not running", () => {
        const store = new TestStore();
        store.open("k").settle(e => { e.status = "succeeded"; });
        store.cancel("k");
        assert.equal(store.statusOf("k"), "succeeded");
    });
});

describe("TrackedChannelStore — clearChannels", () => {
    test("drops all entries and versions", () => {
        const store = new TestStore();
        store.open("k").settle(e => { e.status = "succeeded"; });
        store.wipe();
        assert.equal(store.entryOf("k"), undefined);
        assert.equal(store.getKeyVersion("k"), 0);
    });
});

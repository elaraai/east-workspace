/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Crypto answers as east-node-std's does, from web-standard globals: the
 * SHA-256 of any text or bytes is node:crypto's, random bytes fill any
 * length, and a UUID is a version 4 one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { BlobType, East, EastError, IntegerType, StringType, equalFor } from "@elaraai/east";
import { Crypto } from "@elaraai/east-web-std";

const hashText = East.function([StringType], StringType, ($, text) => Crypto.hashSha256(text)).toIR().compile(Crypto.Implementation);
const hashBytes = East.function([BlobType], BlobType, ($, bytes) => Crypto.hashSha256Bytes(bytes)).toIR().compile(Crypto.Implementation);
const randomBytes = East.function([IntegerType], BlobType, ($, length) => Crypto.randomBytes(length)).toIR().compile(Crypto.Implementation);
const uuid = East.function([], StringType, _$ => Crypto.uuid()).toIR().compile(Crypto.Implementation);

const equalBlobs = equalFor(BlobType);

/** node:crypto's SHA-256 of text, as hex. */
const nodeHashText = (text: string): string => createHash("sha256").update(text, "utf-8").digest("hex");

/** node:crypto's SHA-256 of bytes. */
const nodeHashBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(bytes).digest());

/** Bytes 0, 1, 2, … of a length, so each length hashes differently. */
const counting = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 0xff);

describe("Crypto.hashSha256", () => {
    it("gives the FIPS 180-4 digests", () => {
        assert.equal(hashText(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert.equal(hashText("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert.equal(
            hashText("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        );
    });

    it("gives node:crypto's digest of the text's UTF-8, for any text", () => {
        const texts = [
            "test data", "password", "é", "日本語", "🙂 emoji", "\u0000", "a\u0000b",
            // A lone surrogate encodes as U+FFFD, in node:crypto and TextEncoder alike
            "\ud800", "a\udc00b", "\ud83d",
            ...Array.from({ length: 140 }, (_, n) => "x".repeat(n)),
            "日".repeat(1000),
        ];
        for (const text of texts) {
            assert.equal(hashText(text), nodeHashText(text), `the digest of ${JSON.stringify(text)}`);
        }
    });
});

describe("Crypto.hashSha256Bytes", () => {
    it("gives node:crypto's digest for every length across the padding boundaries", () => {
        for (let length = 0; length <= 200; length++) {
            const bytes = counting(length);
            assert.ok(equalBlobs(hashBytes(bytes), nodeHashBytes(bytes)), `the digest of ${length} bytes`);
        }
    });

    it("gives node:crypto's digest of a multi-megabyte input", () => {
        const bytes = new Uint8Array(nodeRandomBytes(3 * 1024 * 1024 + 17));
        assert.ok(equalBlobs(hashBytes(bytes), nodeHashBytes(bytes)));
    });

    it("gives 32 bytes, the hex digest's", () => {
        const digest = hashBytes(counting(3));
        assert.equal(digest.length, 32);
        assert.equal(Buffer.from(digest).toString("hex"), createHash("sha256").update(counting(3)).digest("hex"));
    });
});

describe("Crypto.randomBytes", () => {
    it("gives the length asked for, however many calls it takes to fill", () => {
        for (const length of [0, 1, 16, 65535, 65536, 65537, 200_000]) {
            assert.equal(randomBytes(BigInt(length)).length, length);
        }
    });

    it("fills every chunk it draws", () => {
        // crypto.getRandomValues fills at most 65536 bytes a call: each chunk
        // of a longer draw is filled, so none is left zero
        const bytes = randomBytes(200_000n);
        for (let start = 0; start < bytes.length; start += 65536) {
            const chunk = bytes.subarray(start, start + 65536);
            assert.ok(chunk.some(byte => byte !== 0), `the chunk at ${start} is all zero`);
        }
    });

    it("draws different bytes each call", () => {
        assert.ok(!equalBlobs(randomBytes(32n), randomBytes(32n)));
    });

    it("fails a negative length, or one past 2^31 - 1, with an EastError", () => {
        for (const length of [-1n, 2n ** 31n]) {
            assert.throws(
                () => randomBytes(length),
                (error: unknown) => error instanceof EastError
                    && error.message === `Failed to generate random bytes: the length must be from 0 to 2147483647, got ${length}`,
            );
        }
    });
});

describe("Crypto.uuid", () => {
    it("gives a version 4 UUID, a new one each call", () => {
        const ids = Array.from({ length: 100 }, () => uuid());
        for (const id of ids) {
            assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        }
        assert.equal(new Set(ids).size, ids.length);
    });
});

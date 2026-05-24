/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, Crypto, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./crypto.examples.js";

describeEast("Crypto platform functions", (test) => {
    Assert.examples(test, { cryptoRandomBytes: ex.cryptoRandomBytes, cryptoHashSha256: ex.cryptoHashSha256, cryptoHashSha256Bytes: ex.cryptoHashSha256Bytes, cryptoUuid: ex.cryptoUuid });

    test("randomBytes generates correct length", $ => {
        const bytes = $.let(Crypto.randomBytes(16n));
        const len = $.let(bytes.size());

        $(Assert.equal(len, 16n));
    });

    test("hashSha256 produces consistent hashes", $ => {
        const hash1 = $.let(Crypto.hashSha256("test data"));
        const hash2 = $.let(Crypto.hashSha256("test data"));

        $(Assert.equal(hash1, hash2));
    });

    test("hashSha256 produces correct length", $ => {
        const hash = $.let(Crypto.hashSha256("test"));
        const len = $.let(hash.length());

        // SHA-256 hex string is 64 characters
        $(Assert.equal(len, 64n));
    });

    test("hashSha256Bytes produces 32 bytes", $ => {
        const data = $.let(new Uint8Array([1, 2, 3]));
        const hash = $.let(Crypto.hashSha256Bytes(data));
        const len = $.let(hash.size());

        // SHA-256 produces 32 bytes
        $(Assert.equal(len, 32n));
    });

    test("uuid generates valid format", $ => {
        const uuid = $.let(Crypto.uuid());
        const len = $.let(uuid.length());

        // UUID is 36 characters (32 hex + 4 dashes)
        $(Assert.equal(len, 36n));

        // Check it contains dashes
        $(Assert.equal(uuid.contains("-"), true));
    });

    test("uuid generates unique values", $ => {
        const uuid1 = $.let(Crypto.uuid());
        const uuid2 = $.let(Crypto.uuid());

        $(Assert.notEqual(uuid1, uuid2));
    });
}, { platformFns: NodePlatform });

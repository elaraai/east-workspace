/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MongoDB platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require MongoDB running on localhost:27017.
 * Run `npm run dev:services` to start Docker containers.
 */
import { East, variant } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import { Console, describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { NoSQL, mongodb_delete_many, mongodb_close_all } from "@elaraai/east-node-io";
import * as ex from "./mongodb.examples.js";

// MongoDB test configuration
const TEST_CONFIG = {
    uri: "mongodb://testuser:testpass@localhost:27017",
    database: "test",
    collection: "east_test",
};

await describeEast("MongoDB platform functions", (test) => {
    Assert.examples(test, { mongodbConnect: ex.mongodbConnect, mongodbClose: ex.mongodbClose, mongodbInsertOne: ex.mongodbInsertOne, mongodbFindOne: ex.mongodbFindOne, mongodbFindMany: ex.mongodbFindMany, mongodbUpdateOne: ex.mongodbUpdateOne, mongodbDeleteOne: ex.mongodbDeleteOne });

    test("connect and close MongoDB connection", $ => {
        Console.log("connect and close MongoDB connection");

        const config = $.let(TEST_CONFIG);
        const handle = $.let(NoSQL.MongoDB.connect(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Close connection
        $(NoSQL.MongoDB.close(handle));
    });

    test("insertOne creates document successfully", $ => {
        Console.log("insertOne creates document successfully");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Create document
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["name", variant('String', "Alice")],
            ["age", variant('Integer', 30n)],
            ["active", variant('Boolean', true)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        $(NoSQL.MongoDB.insertOne(conn, doc));

        $(NoSQL.MongoDB.close(conn));
    });

    test("findOne retrieves inserted document", $ => {

        const config = $.let(TEST_CONFIG);
        
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert document
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["username", variant('String', "bob123")],
            ["email", variant('String', "bob@example.com")],
            ["score", variant('Integer', 42n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const insertedId = $.let(NoSQL.MongoDB.insertOne(conn, doc));

        // Query for it
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["username", variant('String', "bob123")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const result = $.let(NoSQL.MongoDB.findOne(conn, query));

        // Verify document was found with all fields
        $.match(result, {
            some: ($, foundDoc) => {
                $(Assert.equal(foundDoc, East.value(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                    ["_id", variant('String', insertedId)],
                    ["email", variant('String', "bob@example.com")],
                    ["score", variant('Integer', 42n)],
                    ["username", variant('String', "bob123")],
                ]), NoSQL.MongoDB.Types.BsonDocument)));
            },
            none: ($) => $(Assert.fail("Expected to find document")),
        });

        $(NoSQL.MongoDB.close(conn));
    });

    test("findOne returns None for non-existent document", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Query for non-existent document
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["nonexistent_field", variant('String', "nonexistent_value")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const result = $.let(NoSQL.MongoDB.findOne(conn, query));

        // Verify None
        $.match(result, {
            some: ($) => $(Assert.fail("Expected None for non-existent document")),
        });

        $(NoSQL.MongoDB.close(conn));
    });

    test("findMany retrieves multiple documents", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert multiple documents
        const doc1 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["category", variant('String', "test-category")],
            ["value", variant('Integer', 1n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const doc2 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["category", variant('String', "test-category")],
            ["value", variant('Integer', 2n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        $(NoSQL.MongoDB.insertOne(conn, doc1));
        $(NoSQL.MongoDB.insertOne(conn, doc2));

        // Query for all documents in category
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["category", variant('String', "test-category")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const options = $.let({
            limit: variant('none', null),
            skip: variant('none', null),
        });

        const results = $.let(NoSQL.MongoDB.findMany(conn, query, options));

        // Should have at least 2 documents
        $(Assert.greaterEqual(results.size(), East.value(2n)));

        $(NoSQL.MongoDB.close(conn));
    });

    test("findMany supports limit option", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert multiple documents
        const doc1 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["limit_test", variant('String', "yes")],
            ["index", variant('Integer', 1n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const doc2 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["limit_test", variant('String', "yes")],
            ["index", variant('Integer', 2n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const doc3 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["limit_test", variant('String', "yes")],
            ["index", variant('Integer', 3n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        $(NoSQL.MongoDB.insertOne(conn, doc1));
        $(NoSQL.MongoDB.insertOne(conn, doc2));
        $(NoSQL.MongoDB.insertOne(conn, doc3));

        // Query with limit
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["limit_test", variant('String', "yes")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const options = $.let({
            limit: variant('some', 2n),
            skip: variant('none', null),
        });

        const results = $.let(NoSQL.MongoDB.findMany(conn, query, options));

        // Should have exactly 2 documents
        $(Assert.equal(results.size(), East.value(2n)));

        $(NoSQL.MongoDB.close(conn));
    });

    test("updateOne modifies document successfully", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert document
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["update_test", variant('String', "original")],
            ["counter", variant('Integer', 10n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const insertedId = $.let(NoSQL.MongoDB.insertOne(conn, doc));

        // Update it
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["update_test", variant('String', "original")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const update = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["$set", variant('Object', new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                ["counter", variant('Integer', 20n)],
            ]))],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const modified = $.let(NoSQL.MongoDB.updateOne(conn, query, update));

        // Should have modified 1 document
        $(Assert.equal(modified, East.value(1n)));

        // Verify update
        const result = $.let(NoSQL.MongoDB.findOne(conn, query));

        $.match(result, {
            some: ($, foundDoc) => {
                $(Assert.equal(foundDoc, East.value(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                    ["_id", variant('String', insertedId)],
                    ["counter", variant('Integer', 20n)],
                    ["update_test", variant('String', "original")],
                ]), NoSQL.MongoDB.Types.BsonDocument)));
            },
            none: ($) => $(Assert.fail("Expected to find updated document")),
        });

        $(NoSQL.MongoDB.close(conn));
    });

    test("updateOne returns 0 for non-existent document", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Try to update non-existent document
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["nonexistent", variant('String', "document")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const update = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["$set", variant('Object', new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                ["field", variant('String', "value")],
            ]))],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const modified = $.let(NoSQL.MongoDB.updateOne(conn, query, update));

        // Should have modified 0 documents
        $(Assert.equal(modified, East.value(0n)));

        $(NoSQL.MongoDB.close(conn));
    });

    test("deleteOne removes document successfully", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert document
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["delete_test", variant('String', "to-be-deleted")],
            ["value", variant('Integer', 99n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        $(NoSQL.MongoDB.insertOne(conn, doc));

        // Delete it
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["delete_test", variant('String', "to-be-deleted")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const deleted = $.let(NoSQL.MongoDB.deleteOne(conn, query));

        // Should have deleted 1 document
        $(Assert.equal(deleted, East.value(1n)));

        // Verify deletion
        const result = $.let(NoSQL.MongoDB.findOne(conn, query));

        $.match(result, {
            some: ($) => $(Assert.fail("Expected None after deletion")),
        });

        $(NoSQL.MongoDB.close(conn));
    });

    test("deleteOne returns 0 for non-existent document", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Try to delete non-existent document
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["nonexistent", variant('String', "document")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const deleted = $.let(NoSQL.MongoDB.deleteOne(conn, query));

        // Should have deleted 0 documents
        $(Assert.equal(deleted, East.value(0n)));

        $(NoSQL.MongoDB.close(conn));
    });

    test("handles nested documents", $ => {

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Insert document with nested object
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["nested_test", variant('String', "parent")],
            ["metadata", variant('Object', new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                ["created_by", variant('String', "admin")],
                ["version", variant('Integer', 1n)],
            ]))],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const insertedId = $.let(NoSQL.MongoDB.insertOne(conn, doc));

        // Query for it
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["nested_test", variant('String', "parent")],
        ]), NoSQL.MongoDB.Types.BsonDocument);

        const result = $.let(NoSQL.MongoDB.findOne(conn, query));

        // Verify nested object
        $.match(result, {
            some: ($, foundDoc) => {
                $(Assert.equal(foundDoc, East.value(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                    ["_id", variant('String', insertedId)],
                    ["metadata", variant('Object', new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                        ["created_by", variant('String', "admin")],
                        ["version", variant('Integer', 1n)],
                    ]))],
                    ["nested_test", variant('String', "parent")],
                ]), NoSQL.MongoDB.Types.BsonDocument)));
            },
            none: ($) => $(Assert.fail("Expected to find document")),
        });

        $(NoSQL.MongoDB.close(conn));
    });
}, {
    platformFns: [...NoSQL.MongoDB.Implementation, ...NodePlatform],
    beforeEach: $ => {
        // Clear the collection before each test for isolation
        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.MongoDB.connect(config));

        // Delete all documents (empty query matches all)
        const emptyQuery = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([]), NoSQL.MongoDB.Types.BsonDocument);
        $(mongodb_delete_many(conn, emptyQuery));

        // Close this connection (afterEach will close all)
        $(NoSQL.MongoDB.close(conn));
    },
    afterEach: $ => {
        // Close all connections after each test (even on failure)
        $(mongodb_close_all());
    }
});

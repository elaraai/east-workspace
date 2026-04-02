/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, variant, example } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import { NoSQL } from "@elaraai/east-node-io";

const mongoConfig = {
    uri: "mongodb://testuser:testpass@localhost:27017",
    database: "test",
    collection: "east_test",
};

export const mongodbConnect = example({
    keywords: ["mongodb", "MongoDB", "connect", "connection"],
    description: "Connect to a MongoDB server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(mongoConfig);
        const handle = $.let(NoSQL.MongoDB.connect(config));
        $(NoSQL.MongoDB.close(handle));
    }),
    inputs: [],
});

export const mongodbClose = example({
    keywords: ["mongodb", "MongoDB", "close", "disconnect"],
    description: "Close a MongoDB connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(mongoConfig);
        const handle = $.let(NoSQL.MongoDB.connect(config));
        $(NoSQL.MongoDB.close(handle));
    }),
    inputs: [],
});

export const mongodbInsertOne = example({
    keywords: ["mongodb", "MongoDB", "insertOne", "insert", "create", "document"],
    description: "Insert a document into MongoDB returns a non-empty id",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(mongoConfig);
        const conn = $.let(NoSQL.MongoDB.connect(config));
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["name", variant('String', "Alice")],
            ["age", variant('Integer', 30n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const insertedId = $.let(NoSQL.MongoDB.insertOne(conn, doc));
        $(NoSQL.MongoDB.close(conn));
        return insertedId.length().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const mongodbFindOne = example({
    keywords: ["mongodb", "MongoDB", "findOne", "find", "query", "read"],
    description: "Find a single document in MongoDB by query returns a non-empty document",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let(mongoConfig);
        const conn = $.let(NoSQL.MongoDB.connect(config));
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["find_test", variant('String', "example")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        $(NoSQL.MongoDB.insertOne(conn, doc));
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["find_test", variant('String', "example")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const result = $.let(NoSQL.MongoDB.findOne(conn, query));
        const foundDoc = $.let(result.unwrap("some"));
        $(NoSQL.MongoDB.close(conn));
        return foundDoc.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const mongodbFindMany = example({
    keywords: ["mongodb", "MongoDB", "findMany", "find", "query", "multiple"],
    description: "Find multiple documents in MongoDB with options",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(mongoConfig);
        const conn = $.let(NoSQL.MongoDB.connect(config));
        const doc1 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["batch", variant('String', "example")],
            ["value", variant('Integer', 1n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const doc2 = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["batch", variant('String', "example")],
            ["value", variant('Integer', 2n)],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        $(NoSQL.MongoDB.insertOne(conn, doc1));
        $(NoSQL.MongoDB.insertOne(conn, doc2));
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["batch", variant('String', "example")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const options = $.let({
            limit: variant('none', null),
            skip: variant('none', null),
        });
        const results = $.let(NoSQL.MongoDB.findMany(conn, query, options));
        $(NoSQL.MongoDB.close(conn));
        return results.size();
    }),
    inputs: [],
    returns: 2n,
});

export const mongodbUpdateOne = example({
    keywords: ["mongodb", "MongoDB", "updateOne", "update", "modify"],
    description: "Update a single document in MongoDB",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(mongoConfig);
        const conn = $.let(NoSQL.MongoDB.connect(config));
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["update_ex", variant('String', "original")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        $(NoSQL.MongoDB.insertOne(conn, doc));
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["update_ex", variant('String', "original")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const update = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["$set", variant('Object', new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
                ["update_ex", variant('String', "modified")],
            ]))],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const modified = $.let(NoSQL.MongoDB.updateOne(conn, query, update));
        $(NoSQL.MongoDB.close(conn));
        return modified;
    }),
    inputs: [],
    returns: 1n,
});

export const mongodbDeleteOne = example({
    keywords: ["mongodb", "MongoDB", "deleteOne", "delete", "remove"],
    description: "Delete a single document from MongoDB",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(mongoConfig);
        const conn = $.let(NoSQL.MongoDB.connect(config));
        const doc = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["delete_ex", variant('String', "to-delete")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        $(NoSQL.MongoDB.insertOne(conn, doc));
        const query = $.let(new Map<string, ValueTypeOf<typeof NoSQL.MongoDB.Types.BsonValue>>([
            ["delete_ex", variant('String', "to-delete")],
        ]), NoSQL.MongoDB.Types.BsonDocument);
        const deleted = $.let(NoSQL.MongoDB.deleteOne(conn, query));
        $(NoSQL.MongoDB.close(conn));
        return deleted;
    }),
    inputs: [],
    returns: 1n,
});

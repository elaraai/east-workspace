#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared NoSQL type definitions for East Python IO.

Provides East type definitions for Redis and MongoDB operations.
"""

from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
)

RedisConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("password", OptionType(StringType)),
        ("db", OptionType(IntegerType)),
        ("keyPrefix", OptionType(StringType)),
    ]
)
"""Redis connection configuration.

Fields: ``host`` (``String``), ``port`` (``Integer``),
``password`` (``Option<String>`` - authentication password; absent means
no password), ``db`` (``Option<Integer>`` - logical database index,
default 0), ``keyPrefix`` (``Option<String>`` - prefix prepended to every
key managed through this connection; absent means no prefix).
"""

MongoConfigType = StructType(
    [
        ("uri", StringType),
        ("database", StringType),
        ("collection", StringType),
    ]
)
"""MongoDB connection and target configuration.

Fields: ``uri`` (``String`` - MongoDB connection URI, e.g.
``mongodb://localhost:27017``), ``database`` (``String`` - database
name), ``collection`` (``String`` - collection name within the database).
"""

MongoFindOptionsType = StructType(
    [
        ("limit", OptionType(IntegerType)),
        ("skip", OptionType(IntegerType)),
    ]
)
"""Pagination options for MongoDB find queries.

Fields: ``limit`` (``Option<Integer>`` - maximum documents to return;
absent means no limit), ``skip`` (``Option<Integer>`` - documents to
skip before returning results; absent means 0).
"""

ConnectionHandleType = StringType
"""Opaque ``String`` handle identifying an open database connection.

Returned by ``mongodb_connect`` / ``redis_connect`` and passed to every
subsequent operation. The handle is a UUID generated at connect time and
is only valid within the same process lifetime.
"""

BsonValueType = RecursiveType(
    lambda self: VariantType(
        [
            ("String", StringType),
            ("Integer", IntegerType),
            ("Float", FloatType),
            ("Boolean", BooleanType),
            ("Null", NullType),
            ("Array", ArrayType(self)),
            ("Object", DictType(StringType, self)),
        ]
    )
)
"""BSON-compatible recursive value type for MongoDB documents.

Cases: ``String`` (``String``), ``Integer`` (``Integer``),
``Float`` (``Float``), ``Boolean`` (``Boolean``), ``Null`` (``Null``),
``Array`` (``Array<BsonValue>`` - nested elements of the same type),
``Object`` (``Dict<String, BsonValue>`` - nested key-value pairs).
``datetime`` and ``ObjectId`` BSON types are coerced on read: datetimes
become ``Integer`` (Unix timestamp in seconds, UTC), ObjectIds become
``String``.
"""

MongoDocumentType = DictType(StringType, BsonValueType)
"""MongoDB document - a ``Dict<String, BsonValue>`` mapping field names to values.

The ``_id`` field, if present, is always coerced to ``String`` (the
hex representation of the ObjectId).
"""

__all__ = [
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "ConnectionHandleType",
    "BsonValueType",
    "MongoDocumentType",
]

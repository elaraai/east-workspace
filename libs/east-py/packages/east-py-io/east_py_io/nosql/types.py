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
    StringType,
    StructType,
    VariantType,
)

# Redis configuration
RedisConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("password", OptionType(StringType)),
        ("db", OptionType(IntegerType)),
        ("keyPrefix", OptionType(StringType)),
    ]
)

# MongoDB configuration
MongoConfigType = StructType(
    [
        ("uri", StringType),
        ("database", StringType),
        ("collection", StringType),
    ]
)

# MongoDB find options
MongoFindOptionsType = StructType(
    [
        ("limit", OptionType(IntegerType)),
        ("skip", OptionType(IntegerType)),
    ]
)

# Connection handle type
ConnectionHandleType = StringType

# BSON-compatible value type (simplified - no recursive types in Python version)
BsonValueType = VariantType(
    [
        ("String", StringType),
        ("Integer", IntegerType),
        ("Float", FloatType),
        ("Boolean", BooleanType),
        ("Null", NullType),
        ("Array", ArrayType(StringType)),  # Simplified
        ("Object", DictType(StringType, StringType)),  # Simplified
    ]
)

# Document type for MongoDB
MongoDocumentType = DictType(StringType, BsonValueType)

__all__ = [
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "ConnectionHandleType",
    "BsonValueType",
    "MongoDocumentType",
]

#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NoSQL module - Redis caching and MongoDB document storage."""

from east_py_io.nosql.mongodb import (
    mongo_close_all_impl,
    mongo_close_impl,
    mongo_connect_impl,
    mongo_delete_one_impl,
    mongo_find_impl,
    mongo_find_one_impl,
    mongo_insert_one_impl,
    mongo_update_one_impl,
    mongodb_impl,
)
from east_py_io.nosql.redis_impl import (
    redis_close_all_impl,
    redis_close_impl,
    redis_connect_impl,
    redis_del_impl,
    redis_get_impl,
    redis_impl,
    redis_set_impl,
    redis_setex_impl,
)
from east_py_io.nosql.types import (
    BsonValueType,
    ConnectionHandleType,
    MongoConfigType,
    MongoDocumentType,
    MongoFindOptionsType,
    RedisConfigType,
)

__all__ = [
    # Types
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "ConnectionHandleType",
    "BsonValueType",
    "MongoDocumentType",
    # Redis
    "redis_impl",
    "redis_connect_impl",
    "redis_get_impl",
    "redis_set_impl",
    "redis_setex_impl",
    "redis_del_impl",
    "redis_close_impl",
    "redis_close_all_impl",
    # MongoDB
    "mongodb_impl",
    "mongo_connect_impl",
    "mongo_insert_one_impl",
    "mongo_find_one_impl",
    "mongo_find_impl",
    "mongo_update_one_impl",
    "mongo_delete_one_impl",
    "mongo_close_impl",
    "mongo_close_all_impl",
]

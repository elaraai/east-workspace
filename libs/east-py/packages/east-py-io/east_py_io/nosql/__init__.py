#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NoSQL platform functions for East - Redis caching and MongoDB document storage.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported here for building inputs with ``coerce_to`` and validating
outputs.
"""

from east_py_io.nosql.mongodb import (
    mongo_close,
    mongo_close_all,
    mongo_connect,
    mongo_delete_many,
    mongo_delete_one,
    mongo_find,
    mongo_find_one,
    mongo_insert_one,
    mongo_update_one,
    mongodb_impl,
)
from east_py_io.nosql.redis_impl import (
    redis_close,
    redis_close_all,
    redis_connect,
    redis_del,
    redis_get,
    redis_impl,
    redis_set,
    redis_setex,
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
    # East type definitions
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "ConnectionHandleType",
    "BsonValueType",
    "MongoDocumentType",
    # Platform registration lists
    "redis_impl",
    "mongodb_impl",
    # Directly-callable Redis implementations
    "redis_connect",
    "redis_get",
    "redis_set",
    "redis_setex",
    "redis_del",
    "redis_close",
    "redis_close_all",
    # Directly-callable MongoDB implementations
    "mongo_connect",
    "mongo_insert_one",
    "mongo_find_one",
    "mongo_find",
    "mongo_update_one",
    "mongo_delete_one",
    "mongo_delete_many",
    "mongo_close",
    "mongo_close_all",
]

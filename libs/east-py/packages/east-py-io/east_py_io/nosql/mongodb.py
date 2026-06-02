#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MongoDB platform functions for East.

Provides MongoDB document store operations for East programs,
including CRUD operations on documents.
"""

import importlib.util
import uuid
from datetime import UTC, datetime
from typing import Any

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, IntegerType, NullType, OptionType, StringType
from east.types.values import EastArray, EastDict, EastStruct, EastVariant, east_null

try:
    from bson import ObjectId as _BsonObjectId
except ImportError:  # bson ships with the mongodb extra; absent otherwise
    _BsonObjectId = None

_HAS_MONGODB_SUPPORT = importlib.util.find_spec("motor") is not None


def _check_mongodb_support() -> None:
    """Check if MongoDB support is available."""
    if not _HAS_MONGODB_SUPPORT:
        raise NotImplementedError(
            "MongoDB support requires the 'mongodb' extra. "
            "Add east-py-io[mongodb] to your pyproject.toml dependencies."
        )

from .types import (
    BsonValueType,
    ConnectionHandleType,
    MongoConfigType,
    MongoDocumentType,
    MongoFindOptionsType,
)

# Connection storage
_clients: dict[str, tuple[Any, Any]] = {}  # handle -> (client, collection)


def convert_bson_to_east(value: Any) -> EastVariant:
    """Convert BSON value to East variant format."""
    if value is None:
        return EastVariant("Null", east_null)
    elif isinstance(value, bool):
        return EastVariant("Boolean", value)
    elif isinstance(value, int):
        return EastVariant("Integer", value)
    elif isinstance(value, float):
        return EastVariant("Float", value)
    elif isinstance(value, str):
        return EastVariant("String", value)
    elif isinstance(value, datetime):
        # BsonValue has no DateTime case; emit a Unix timestamp in seconds (UTC).
        utc = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return EastVariant("Integer", int(utc.timestamp()))
    elif _BsonObjectId is not None and isinstance(value, _BsonObjectId):
        return EastVariant("String", str(value))
    elif isinstance(value, list):
        return EastVariant(
            "Array", EastArray(BsonValueType, [convert_bson_to_east(v) for v in value])
        )
    elif isinstance(value, dict):
        obj = EastDict(StringType, BsonValueType)
        for k, v in value.items():
            obj[k] = convert_bson_to_east(v)
        return EastVariant("Object", obj)
    else:
        return EastVariant("Null", east_null)


def convert_east_to_bson(value: EastVariant) -> Any:
    """Convert East variant format to BSON value."""
    tag = value.type
    val = value.value

    if tag == "Null":
        return None
    elif tag == "Boolean":
        return val
    elif tag == "Integer":
        return int(val) if val is not None else 0
    elif tag == "Float" or tag == "String":
        return val
    elif tag == "Array":
        return [convert_east_to_bson(v) for v in val] if val else []
    elif tag == "Object":
        return {k: convert_east_to_bson(v) for k, v in val.items()} if val else {}
    else:
        return val


def doc_to_east(doc: dict[str, Any]) -> EastDict:
    """Convert MongoDB document (Python dict) to East format (EastDict)."""
    result: EastDict = EastDict(StringType, BsonValueType)
    for key, value in doc.items():
        if key == "_id":
            result[key] = EastVariant("String", str(value))
        else:
            result[key] = convert_bson_to_east(value)
    return result


def east_to_doc(doc: EastDict) -> dict[str, Any]:
    """Convert East document (EastDict) to MongoDB format (Python dict)."""
    result: dict[str, Any] = {}
    for key, value in doc.items():
        result[key] = convert_east_to_bson(value)
    return result


@platform_function(name="mongodb_connect", inputs=[MongoConfigType], output=ConnectionHandleType)
async def mongo_connect_impl(config: EastStruct) -> str:
    """Connect to a MongoDB database."""
    _check_mongodb_support()
    from motor.motor_asyncio import AsyncIOMotorClient

    try:
        uri = config["uri"]
        database = config["database"]
        collection = config["collection"]

        client: AsyncIOMotorClient = AsyncIOMotorClient(uri)

        # Test connection
        await client.admin.command("ping")

        # Get collection
        db = client[database]
        coll = db[collection]

        # Generate handle
        handle = str(uuid.uuid4())
        _clients[handle] = (client, coll)

        return handle
    except Exception as e:
        raise Exception(f"MongoDB connection failed: {e}") from e


@platform_function(
    name="mongodb_insert_one",
    inputs=[ConnectionHandleType, MongoDocumentType],
    output=StringType,
)
async def mongo_insert_one_impl(handle: str, document: EastDict) -> str:
    """Insert a document into MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        doc = east_to_doc(document)
        result = await coll.insert_one(doc)
        return str(result.inserted_id)
    except Exception as e:
        raise Exception(f"MongoDB insertOne failed: {e}") from e


@platform_function(
    name="mongodb_find_one",
    inputs=[ConnectionHandleType, MongoDocumentType],
    output=OptionType(MongoDocumentType),
)
async def mongo_find_one_impl(handle: str, filter_doc: EastDict) -> EastVariant:
    """Find a single document in MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        query = east_to_doc(filter_doc)
        result = await coll.find_one(query)

        if result is None:
            return EastVariant("none", None)

        east_doc = doc_to_east(result)
        return EastVariant("some", east_doc)
    except Exception as e:
        raise Exception(f"MongoDB findOne failed: {e}") from e


@platform_function(
    name="mongodb_find_many",
    inputs=[ConnectionHandleType, MongoDocumentType, MongoFindOptionsType],
    output=ArrayType(MongoDocumentType),
)
async def mongo_find_impl(handle: str, filter_doc: EastDict, options: EastStruct) -> EastArray:
    """Find documents in MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        query = east_to_doc(filter_doc)

        cursor = coll.find(query)

        skip_opt = options["skip"]
        if skip_opt.type == "some":
            cursor = cursor.skip(int(skip_opt.value))

        limit_opt = options["limit"]
        if limit_opt.type == "some":
            cursor = cursor.limit(int(limit_opt.value))

        results = []
        async for doc in cursor:
            east_doc = doc_to_east(doc)
            results.append(east_doc)

        return EastArray(MongoDocumentType, results)
    except Exception as e:
        raise Exception(f"MongoDB find failed: {e}") from e


@platform_function(
    name="mongodb_update_one",
    inputs=[ConnectionHandleType, MongoDocumentType, MongoDocumentType],
    output=IntegerType,
)
async def mongo_update_one_impl(handle: str, filter_doc: EastDict, update_doc: EastDict) -> int:
    """Update a document in MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        query = east_to_doc(filter_doc)
        update_native = east_to_doc(update_doc)

        # Check if update_doc already contains MongoDB operators (keys starting with $)
        # If so, pass it directly; otherwise wrap with $set
        has_operators = any(key.startswith("$") for key in update_native)
        update = update_native if has_operators else {"$set": update_native}

        result = await coll.update_one(query, update)
        return result.modified_count
    except Exception as e:
        raise Exception(f"MongoDB updateOne failed: {e}") from e


@platform_function(
    name="mongodb_delete_one",
    inputs=[ConnectionHandleType, MongoDocumentType],
    output=IntegerType,
)
async def mongo_delete_one_impl(handle: str, filter_doc: EastDict) -> int:
    """Delete a document from MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        query = east_to_doc(filter_doc)
        result = await coll.delete_one(query)
        return result.deleted_count
    except Exception as e:
        raise Exception(f"MongoDB deleteOne failed: {e}") from e


@platform_function(
    name="mongodb_delete_many",
    inputs=[ConnectionHandleType, MongoDocumentType],
    output=IntegerType,
)
async def mongo_delete_many_impl(handle: str, filter_doc: EastDict) -> int:
    """Delete multiple documents from MongoDB."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        _, coll = _clients[handle]
        query = east_to_doc(filter_doc)
        result = await coll.delete_many(query)
        return result.deleted_count
    except Exception as e:
        raise Exception(f"MongoDB deleteMany failed: {e}") from e


@platform_function(name="mongodb_close", inputs=[ConnectionHandleType], output=NullType)
async def mongo_close_impl(handle: str) -> None:
    """Close a MongoDB connection."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client, _ = _clients[handle]
        client.close()
        del _clients[handle]
    except Exception as e:
        raise Exception(f"MongoDB close failed: {e}") from e


@platform_function(name="mongodb_close_all", inputs=[], output=NullType)
async def mongo_close_all_impl() -> None:
    """Close all MongoDB connections."""
    for client, _ in _clients.values():
        client.close()
    _clients.clear()


# Collected from the @platform_function decorations above.
mongodb_impl = platform_functions(__name__)

__all__ = [
    "mongodb_impl",
    "mongo_connect_impl",
    "mongo_insert_one_impl",
    "mongo_find_one_impl",
    "mongo_find_impl",
    "mongo_update_one_impl",
    "mongo_delete_one_impl",
    "mongo_delete_many_impl",
    "mongo_close_impl",
    "mongo_close_all_impl",
]

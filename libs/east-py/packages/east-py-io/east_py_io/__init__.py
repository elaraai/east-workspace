#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Python I/O Platform Functions.

Python implementation of I/O platform functions for the East programming language.
Provides database, storage, file transfer, format, and compression operations.
"""

# Compression module
from east_py_io.compression import (
    GzipLevelType,
    GzipOptionsType,
    TarEntriesType,
    TarEntryType,
    TarExtractedType,
    ZipEntriesType,
    ZipEntryType,
    ZipExtractedType,
    ZipLevelType,
    ZipOptionsType,
    gzip_impl,
    tar_impl,
    zip_impl,
)

# Every platform function under its own name (#667): callable from python and,
# the same object, inside an East body — the printer's provider spelling.
from east_py_io.compression.gzip_impl import (
    gzip_compress,
    gzip_decompress,
)
from east_py_io.compression.tar_impl import (
    tar_create,
    tar_extract,
)
from east_py_io.compression.zip_impl import (
    zip_compress,
    zip_decompress,
)

# Format module
from east_py_io.format import (
    LiteralValueType,
    XlsxCellType,
    XlsxInfoType,
    XlsxReadOptionsType,
    XlsxRowType,
    XlsxSheetInfoType,
    XlsxSheetType,
    XlsxWriteOptionsType,
    XmlNodeType,
    XmlParseConfigType,
    XmlSerializeConfigType,
    xlsx_impl,
    xml_impl,
)
from east_py_io.format.xlsx import (
    xlsx_info,
    xlsx_read,
    xlsx_write,
)
from east_py_io.format.xml_impl import (
    xml_parse,
    xml_serialize,
)

# NoSQL module
from east_py_io.nosql import (
    BsonValueType,
    MongoConfigType,
    MongoDocumentType,
    MongoFindOptionsType,
    RedisConfigType,
    mongodb_impl,
    redis_impl,
)
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
)
from east_py_io.nosql.redis_impl import (
    redis_close,
    redis_close_all,
    redis_connect,
    redis_del,
    redis_get,
    redis_set,
    redis_setex,
)

# SQL module
from east_py_io.sql import (
    AccessBlobConfigType,
    AccessConfigType,
    AccessQueryOptionsType,
    AccessTablesResultType,
    ConnectionHandleType,
    MySqlConfigType,
    PostgresConfigType,
    SqliteConfigType,
    SqlParametersType,
    SqlParameterType,
    SqlResultType,
    SqlRowType,
    access_impl,
    mysql_impl,
    postgres_impl,
    sqlite_impl,
)
from east_py_io.sql.access import (
    access_close,
    access_close_all,
    access_open,
    access_query,
    access_tables,
)
from east_py_io.sql.mysql import (
    mysql_close,
    mysql_close_all,
    mysql_connect,
    mysql_query,
    mysql_select,
)
from east_py_io.sql.postgres import (
    postgres_close,
    postgres_close_all,
    postgres_connect,
    postgres_query,
    postgres_select,
)
from east_py_io.sql.sqlite import (
    sqlite_close,
    sqlite_close_all,
    sqlite_connect,
    sqlite_query,
    sqlite_select,
)
from east_py_io.storage import (
    S3ConfigType,
    S3ListResultType,
    S3ObjectMetadataType,
    s3_delete_object,
    s3_get_object,
    s3_head_object,
    s3_impl,
    s3_list_objects,
    s3_presign_url,
    s3_put_object,
)

# Transfer module
from east_py_io.transfer import (
    FileEntryType,
    FileListType,
    FtpConfigType,
    SftpConfigType,
    ftp_impl,
    sftp_impl,
)
from east_py_io.transfer.ftp_impl import (
    ftp_close,
    ftp_close_all,
    ftp_connect,
    ftp_delete,
    ftp_get,
    ftp_list,
    ftp_put,
)
from east_py_io.transfer.sftp_impl import (
    sftp_close,
    sftp_close_all,
    sftp_connect,
    sftp_delete,
    sftp_get,
    sftp_list,
    sftp_put,
)

__version__ = "0.1.0"

# Complete Python I/O platform implementation
# Pass this list to compile_async() to enable all platform functions
platform = [
    # Storage
    *s3_impl,
    # SQL
    *sqlite_impl,
    *postgres_impl,
    *mysql_impl,
    *access_impl,
    # NoSQL
    *redis_impl,
    *mongodb_impl,
    # Format
    *xlsx_impl,
    *xml_impl,
    # Compression
    *gzip_impl,
    *tar_impl,
    *zip_impl,
    # Transfer
    *ftp_impl,
    *sftp_impl,
]

__all__ = [
    # ---------- platform functions ----------
    "access_close",
    "access_close_all",
    "access_open",
    "access_query",
    "access_tables",
    "ftp_close",
    "ftp_close_all",
    "ftp_connect",
    "ftp_delete",
    "ftp_get",
    "ftp_list",
    "ftp_put",
    "gzip_compress",
    "gzip_decompress",
    "mongo_close",
    "mongo_close_all",
    "mongo_connect",
    "mongo_delete_many",
    "mongo_delete_one",
    "mongo_find",
    "mongo_find_one",
    "mongo_insert_one",
    "mongo_update_one",
    "mysql_close",
    "mysql_close_all",
    "mysql_connect",
    "mysql_query",
    "mysql_select",
    "postgres_close",
    "postgres_close_all",
    "postgres_connect",
    "postgres_query",
    "postgres_select",
    "redis_close",
    "redis_close_all",
    "redis_connect",
    "redis_del",
    "redis_get",
    "redis_set",
    "redis_setex",
    "sftp_close",
    "sftp_close_all",
    "sftp_connect",
    "sftp_delete",
    "sftp_get",
    "sftp_list",
    "sftp_put",
    "sqlite_close",
    "sqlite_close_all",
    "sqlite_connect",
    "sqlite_query",
    "sqlite_select",
    "tar_create",
    "tar_extract",
    "xlsx_info",
    "xlsx_read",
    "xlsx_write",
    "xml_parse",
    "xml_serialize",
    "zip_compress",
    "zip_decompress",
    "__version__",
    "platform",
    # Storage types and implementations
    "S3ConfigType",
    "S3ObjectMetadataType",
    "S3ListResultType",
    "s3_impl",
    "s3_put_object",
    "s3_get_object",
    "s3_head_object",
    "s3_delete_object",
    "s3_list_objects",
    "s3_presign_url",
    # SQL types
    "SqliteConfigType",
    "PostgresConfigType",
    "MySqlConfigType",
    "AccessConfigType",
    "AccessBlobConfigType",
    "AccessQueryOptionsType",
    "AccessTablesResultType",
    "ConnectionHandleType",
    "SqlParametersType",
    "SqlParameterType",
    "SqlRowType",
    "SqlResultType",
    "sqlite_impl",
    "postgres_impl",
    "mysql_impl",
    "access_impl",
    # NoSQL types
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "BsonValueType",
    "MongoDocumentType",
    "redis_impl",
    "mongodb_impl",
    # Format types
    "LiteralValueType",
    "XlsxCellType",
    "XlsxRowType",
    "XlsxSheetType",
    "XlsxReadOptionsType",
    "XlsxWriteOptionsType",
    "XlsxSheetInfoType",
    "XlsxInfoType",
    "XmlNodeType",
    "XmlParseConfigType",
    "XmlSerializeConfigType",
    "xlsx_impl",
    "xml_impl",
    # Compression types
    "GzipLevelType",
    "GzipOptionsType",
    "ZipLevelType",
    "ZipOptionsType",
    "ZipEntryType",
    "ZipEntriesType",
    "ZipExtractedType",
    "TarEntryType",
    "TarEntriesType",
    "TarExtractedType",
    "gzip_impl",
    "tar_impl",
    "zip_impl",
    # Transfer types
    "FtpConfigType",
    "SftpConfigType",
    "FileEntryType",
    "FileListType",
    "ftp_impl",
    "sftp_impl",
]

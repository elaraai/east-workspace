/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * File format platform functions for East Node IO.
 *
 * Provides functions for reading and writing structured file formats like
 * Excel (XLSX), XML, and more.
 *
 * @example
 * ```ts
 * import { East, BlobType, IntegerType } from "@elaraai/east";
 * import { Format } from "@elaraai/east-node-io";
 *
 * const countRows = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
 *     const options = $.let({
 *         sheetName: { tag: "none", value: {} },
 *     });
 *
 *     const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
 *     return $.return(sheet.size());
 * });
 *
 * const compiled = East.compile(countRows.toIR(), Format.XLSX.Implementation);
 * const xlsxBlob = new Uint8Array([]);  // XLSX file bytes
 * compiled(xlsxBlob);  // 100n
 * ```
 *
 * @packageDocumentation
 */

// Export types
export * from "./types.js";

// Export platform functions and implementation
export { xlsx_read, xlsx_write, xlsx_info, XlsxImpl } from "./xlsx.js";
export { xml_parse, xml_serialize, XmlImpl, XmlParseConfig, XmlSerializeConfig, XmlNode } from "./xml.js";

// Import for grouped exports
import { xlsx_read, xlsx_write, xlsx_info, XlsxImpl } from "./xlsx.js";
import { xml_parse, xml_serialize, XmlImpl, XmlParseConfig, XmlSerializeConfig, XmlNode } from "./xml.js";
import {
    XlsxCellType,
    XlsxRowType,
    XlsxSheetType,
    XlsxReadOptionsType,
    XlsxWriteOptionsType,
    XlsxSheetInfoType,
    XlsxInfoType,
} from "./types.js";

/**
 * File format platform functions grouped by format type.
 *
 * Provides organized access to format-specific operations for reading and
 * writing structured data files in East programs.
 *
 * @example
 * ```ts
 * import { East, BlobType } from "@elaraai/east";
 * import { Format } from "@elaraai/east-node-io";
 *
 * const createExcel = East.function([], BlobType, $ => {
 *     const data = $.let([
 *         [East.variant('String', "Name"), East.variant('String', "Age")],
 *         [East.variant('String', "Alice"), East.variant('Float', 30)],
 *         [East.variant('String', "Bob"), East.variant('Float', 25)],
 *     ]);
 *
 *     const options = $.let({
 *         sheetName: { tag: "some", value: "People" },
 *     });
 *
 *     const blob = $.let(Format.XLSX.write(data, options));
 *     return $.return(blob);
 * });
 *
 * const compiled = East.compile(createExcel.toIR(), Format.XLSX.Implementation);
 * const xlsxBlob = compiled();  // Uint8Array with XLSX file bytes
 * ```
 */
export const Format = {
    /**
     * XLSX (Excel) file format operations.
     *
     * Provides functions for reading and writing Excel files as 2D arrays
     * of literal values (strings, numbers, booleans, null).
     */
    XLSX: {
        /**
         * Reads an XLSX file and returns a 2D array of cell values.
         *
         * Parses an Excel file from a blob and extracts data as ArrayType<ArrayType<LiteralValueType>>.
         *
         * @example
         * ```ts
         * import { East, BlobType, IntegerType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const countRows = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
         *     const options = $.let({
         *         sheetName: variant('none', null),
         *     });
         *
         *     const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
         *     $.return(sheet.size());
         * });
         *
         * const compiled = East.compile(countRows.toIR(), Format.XLSX.Implementation);
         * const blob = new Uint8Array([]);
         * compiled(blob);  // 100n
         * ```
         */
        read: xlsx_read,

        /**
         * Writes a 2D array of cell values to an XLSX file.
         *
         * Creates an Excel file from a 2D array of literal values.
         *
         * @example
         * ```ts
         * import { East, BlobType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const createExcel = East.function([], BlobType, $ => {
         *     const data = $.let([
         *         [variant('String', "Name"), variant('String', "Age")],
         *         [variant('String', "Alice"), variant('Float', 30)],
         *     ], Format.XLSX.Types.Sheet);
         *
         *     const options = $.let({
         *         sheetName: variant('some', "People"),
         *     });
         *
         *     const blob = $.let(Format.XLSX.write(data, options));
         *     $.return(blob);
         * });
         *
         * const compiled = East.compile(createExcel.toIR(), Format.XLSX.Implementation);
         * const xlsxBlob = compiled();
         * ```
         */
        write: xlsx_write,

        /**
         * Gets metadata about an XLSX file.
         *
         * Returns sheet names and approximate sizes without reading all data.
         *
         * @example
         * ```ts
         * import { East, BlobType, IntegerType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const countSheets = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
         *     const info = $.let(Format.XLSX.info(xlsxBlob));
         *     $.return(info.sheets.size());
         * });
         *
         * const compiled = East.compile(countSheets.toIR(), Format.XLSX.Implementation);
         * const blob = new Uint8Array([]);
         * compiled(blob);  // 3n
         * ```
         */
        info: xlsx_info,

        /**
         * Node.js implementation of XLSX platform functions.
         *
         * Pass this to {@link East.compile} to enable XLSX operations.
         *
         * @example
         * ```ts
         * import { East, BlobType, NullType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const myFunction = East.function([BlobType], NullType, ($, xlsxBlob) => {
         *     const options = $.let({
         *         sheetName: variant('none', null),
         *     });
         *     const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
         *     $.return(null);
         * });
         *
         * const compiled = East.compile(myFunction.toIR(), Format.XLSX.Implementation);
         * const blob = new Uint8Array([]);
         * compiled(blob);
         * ```
         */
        Implementation: XlsxImpl,

        /**
         * Type definitions for XLSX operations.
         */
        Types: {
            /**
             * A single cell value in a spreadsheet (LiteralValueType).
             */
            Cell: XlsxCellType,

            /**
             * A row of cells in a spreadsheet.
             */
            Row: XlsxRowType,

            /**
             * A 2D array representing a complete worksheet.
             */
            Sheet: XlsxSheetType,

            /**
             * XLSX read options configuration.
             */
            ReadOptions: XlsxReadOptionsType,

            /**
             * XLSX write options configuration.
             */
            WriteOptions: XlsxWriteOptionsType,

            /**
             * Information about a single sheet in an XLSX file.
             */
            SheetInfo: XlsxSheetInfoType,

            /**
             * XLSX file metadata with sheet listing.
             */
            Info: XlsxInfoType,
        },
    },

    /**
     * XML (Extensible Markup Language) file format operations.
     *
     * Provides functions for parsing and serializing XML files as recursive tree structures,
     * where each node contains a tag name, attributes dictionary, and children array.
     */
    XML: {
        /**
         * Parses XML data from a binary blob into a recursive tree structure.
         *
         * Converts XML-formatted binary data into an XmlNode recursive structure.
         * Supports XML declarations, namespaces, CDATA, entity decoding, and comments.
         *
         * @example
         * ```ts
         * import { East, BlobType } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const parseXML = East.function([BlobType], Format.XML.Types.Node, ($, xmlBlob) => {
         *     const config = $.let({
         *         preserveWhitespace: false,
         *         decodeEntities: true,
         *     });
         *
         *     return $.return(Format.XML.parse(xmlBlob, config));
         * });
         *
         * const compiled = East.compile(parseXML.toIR(), Format.XML.Implementation);
         * const xmlBlob = new TextEncoder().encode("<book id='123'><title>East Guide</title></book>");
         * compiled(xmlBlob);  // Returns parsed XML tree
         * ```
         */
        parse: xml_parse,

        /**
         * Serializes a recursive XML tree structure into XML-formatted binary data.
         *
         * Converts an XmlNode recursive structure into XML-formatted binary data.
         * Supports indentation, XML declarations, entity encoding, and self-closing tags.
         *
         * @example
         * ```ts
         * import { East, BlobType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const serializeXML = East.function([Format.XML.Types.Node], BlobType, ($, doc) => {
         *     const config = $.let({
         *         indent: variant('some', "  "),
         *         includeXmlDeclaration: true,
         *         encodeEntities: true,
         *         selfClosingTags: true,
         *     });
         *
         *     return $.return(Format.XML.serialize(doc, config));
         * });
         *
         * const compiled = East.compile(serializeXML.toIR(), Format.XML.Implementation);
         * const xmlNode = { tag: "book", attributes: new Map([["id", "123"]]), children: [] };
         * compiled(xmlNode);  // Returns XML blob
         * ```
         */
        serialize: xml_serialize,

        /**
         * Node.js implementation of XML platform functions.
         *
         * Pass this to {@link East.compile} to enable XML operations.
         *
         * @example
         * ```ts
         * import { East, BlobType, variant } from "@elaraai/east";
         * import { Format } from "@elaraai/east-node-io";
         *
         * const myFunction = East.function([BlobType], BlobType, ($, xmlBlob) => {
         *     const parseConfig = $.let({
         *         preserveWhitespace: false,
         *         decodeEntities: true,
         *     });
         *
         *     const doc = $.let(Format.XML.parse(xmlBlob, parseConfig));
         *
         *     const serializeConfig = $.let({
         *         indent: variant('some', "  "),
         *         includeXmlDeclaration: true,
         *         encodeEntities: true,
         *         selfClosingTags: true,
         *     });
         *
         *     return $.return(Format.XML.serialize(doc, serializeConfig));
         * });
         *
         * const compiled = East.compile(myFunction.toIR(), Format.XML.Implementation);
         * const xmlBlob = new TextEncoder().encode("<book><title>East</title></book>");
         * compiled(xmlBlob);
         * ```
         */
        Implementation: XmlImpl,

        /**
         * Type definitions for XML operations.
         */
        Types: {
            /**
             * XML parsing configuration type.
             */
            ParseConfig: XmlParseConfig,

            /**
             * XML serialization configuration type.
             */
            SerializeConfig: XmlSerializeConfig,

            /**
             * XML node recursive type (element with tag, attributes, and children).
             */
            Node: XmlNode,
        },
    },
} as const;

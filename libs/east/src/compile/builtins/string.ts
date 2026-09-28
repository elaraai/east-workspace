/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinEvaluators, printTypeValue } from "../runtime.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import { BufferWriter } from "../../serialization/binary-utils.js";
import { parseFor, printFor } from "../../serialization/east.js";
import { fromJSONFor, toJSONFor } from "../../serialization/index.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Strings: printing, parsing, regular expressions and JSON. @internal */
export const string_builtins = {
  Print: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    return printFor(T);
  },
  Parse: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const p = parseFor(T);
    return (x: string) => {
      const result = p(x);
      if (result.success) {
        return result.value;
      } else {
        throw new EastError(`Failed to parse ${printTypeValue(T)} at ${result.position}: ${result.error}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  StringConcat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, y: string) => x + y,
  StringRepeat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, y: bigint) => y > 0n ? x.repeat(Number(y)) : "",
  StringLength: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => {
    let len = 0;
    for (const _ of x) len++;
    return BigInt(len);
  },
  StringSubstring: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, from: bigint, to: bigint) => {
    // Convert bigint indices to numbers, handle forgiving semantics like JavaScript
    let fromNum = Number(from);
    let toNum = Number(to);
    
    // Handle negative indices and lengths (forgiving semantics)
    if (fromNum < 0) fromNum = 0;
    if (toNum < 0) toNum = 0;
    if (fromNum > toNum) {
      toNum = fromNum;
    }
    
    // Convert codepoint indices to code unit indices
    let codeUnitFrom = 0;
    let codeUnitTo = 0;
    let codepointIndex = 0;
    
    for (const char of x) {
      if (codepointIndex === fromNum) {
        codeUnitFrom = codeUnitTo;
      }
      if (codepointIndex === toNum) {
        break;
      }
      codeUnitTo += char.length;
      codepointIndex++;
    }
    
    // If 'from' is beyond string length, return empty string
    if (fromNum >= codepointIndex) return "";
    
    // If 'to' is beyond string length, use string end
    if (toNum > codepointIndex) {
      codeUnitTo = x.length;
    }
    
    return x.substring(codeUnitFrom, codeUnitTo);
  },
  StringUpperCase: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.toUpperCase(),
  StringLowerCase: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.toLowerCase(),
  StringSplit: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, delimiter: string) => {
    if (delimiter === "") {
      if (x === "") {
        // Split always returns at least one element
        return [""];
      } else {
        // Split into individual codepoints
        return [...x];
      }
    }
    return x.split(delimiter);
  },
  StringTrim: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trim(),
  StringTrimStart: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trimStart(),
  StringTrimEnd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trimEnd(),
  StringStartsWith: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, prefix: string) => x.startsWith(prefix),
  StringEndsWith: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, suffix: string) => x.endsWith(suffix),
  StringContains: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, substring: string) => x.includes(substring),
  StringIndexOf: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, substring: string) => {
    const codeUnitIndex = x.indexOf(substring);
    if (codeUnitIndex === -1) return -1n;
    
    // Special case for empty substring - it's always found at position 0
    if (substring === "") return BigInt(codeUnitIndex);
    
    // Convert code unit index to codepoint index
    let codepointIndex = 0;
    let codeUnitPos = 0;
    for (const char of x) {
      if (codeUnitPos === codeUnitIndex) {
        return BigInt(codepointIndex);
      }
      codeUnitPos += char.length;
      codepointIndex++;
    }
    return -1n;
  },
  StringReplace: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, searchValue: string, replaceValue: string) => {
    // Replace all occurrences (like JavaScript's string.replaceAll with string)
    return x.replaceAll(searchValue, replaceValue);
  },
  RegexContains: (_loc_id: bigint, _source_map: SourceMap | null) => (text: string, pattern: string, flags: string) => {
    const regex = new RegExp(pattern, flags);
    return regex.test(text);
  },
  RegexIndexOf: (_loc_id: bigint, _source_map: SourceMap | null) => (text: string, pattern: string, flags: string) => {
    const regex = new RegExp(pattern, flags);
    const codeUnitIndex = text.search(regex);
    if (codeUnitIndex === -1) return -1n;

    // Convert code unit index to codepoint index
    let codepointIndex = 0;
    let codeUnitPos = 0;
    for (const char of text) {
      if (codeUnitPos === codeUnitIndex) {
        return BigInt(codepointIndex);
      }
      codeUnitPos += char.length;
      codepointIndex++;
    }
    return -1n;
  },
  RegexReplace: (loc_id: bigint, source_map: SourceMap | null) => (text: string, pattern: string, flags: string, replacement: string) => {
    // Ensure global flag is set for replaceAll semantics
    const globalFlags = flags.includes('g') ? flags : flags + 'g';
    const regex = new RegExp(pattern, globalFlags);

    // Validate replacement string: only allow $$, $1-$9, and $<
    // This is stricter than JavaScript's native behavior but provides clear, consistent semantics
    // and avoids backend-specific features like $&, $`, $'
    let i = 0;
    while (i < replacement.length) {
      const char = replacement[i]!;
      if (char === '$') {
        i += char.length;
        let char2 = replacement[i];
        if (char2 === undefined) {
          throw new EastError(`invalid regex replacement string: unescaped $ at end of string`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        } else if (char2 === '$') {
          i += 1;
        } else if (char2 >= '1' && char2 <= '9') {
          i += 1;
          char2 = replacement[i];
          while (char2 !== undefined && char2 >= '0' && char2 <= '9') {
            i += 1;
            char2 = replacement[i];
          }
        } else if (char2 === '<') {
          // Scan until closing >
          i += 1;
          const init_i = i;
          char2 = replacement[i];
          while (true) {
            if (char2 === undefined) {
              throw new EastError(`invalid regex replacement string: unterminated group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
            }
            if (char2 === '>') {
              break;
            }
            if (!((char2 >= '0' && char2 <= '9') || (char2 >= 'a' && char2 <= 'z') || (char2 >= 'A' && char2 <= 'Z') || char2 === '_')) {
              throw new EastError(`invalid regex replacement string: invalid character ${JSON.stringify(char2)} in group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
            }
            i += 1;
            char2 = replacement[i];
          }
          if (i === init_i) {
            throw new EastError(`invalid regex replacement string: empty group name in $<>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
          }
          i += 1; // for closing >
        } else {
          throw new EastError(`invalid regex replacement string: unescaped $ at $${char2}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
      } else {
        i += char.length;
      }
    }
    return text.replaceAll(regex, replacement);
  },
  StringEncodeUtf8: (_loc_id: bigint, _source_map: SourceMap | null) => {
    // do not add BOM for UTF-8
    const encoder = new TextEncoder();
    return (x: string) => {
      return encoder.encode(x);
    };
  },
  StringEncodeUtf16: (_loc_id: bigint, _source_map: SourceMap | null) => {
    // always use little-endian with BOM (most common in practice)
    return (x: string) => {
      const buffer = new BufferWriter();
      buffer.writeUint8(0xFF);
      buffer.writeUint8(0xFE);
      for (let i = 0; i < x.length; i++) {
        const codeUnit = x.charCodeAt(i);
        buffer.writeUint16LE(codeUnit);
      }
      return buffer.toUint8Array();
    };
  },
  StringParseJSON: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const fromJSON = fromJSONFor(type);
    return (x: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(x);
      } catch (e: unknown) {
        throw new EastError(`Failed to parse JSON: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      try {
        return fromJSON(parsed);
      } catch (e: unknown) {
        throw new EastError(`Failed to convert JSON to ${printTypeValue(type)}: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  StringPrintJSON: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const toJSON = toJSONFor(type);
    return (x: any) => JSON.stringify(toJSON(x));
  },
} satisfies BuiltinEvaluators;

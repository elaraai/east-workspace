/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinEvaluators, printTypeValue } from "../runtime.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import { type Beast2Extents, decodeBeast2For, decodeBeastFor, decodeCsvFor, encodeBeast2For, encodeBeastFor, encodeCsvFor, isBeast2LazySafe, openBeast2LazyFor, readBeast2Extents, readBeast2Type } from "../../serialization/index.js";
import { type EastTypeValue, isTypeValueEqual } from "../../type_of_type.js";

/** The builtins for Blobs, and the codecs that read and write one. @internal */
export const blob_builtins = {
  BlobSize: (_loc_id: bigint, _source_map: SourceMap | null) => (data: Uint8Array) => BigInt(data.length),
  BlobGetUint8: (loc_id: bigint, source_map: SourceMap | null) => (data: Uint8Array, index: bigint) => {
    const i = Number(index);
    if (i < 0 || i >= data.length) {
      throw new EastError(`Blob index ${index} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return BigInt(data[i]!);
    }
  },
  BlobDecodeUtf8: (loc_id: bigint, source_map: SourceMap | null) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return (data: Uint8Array) => {
      try {
        return decoder.decode(data);
      } catch {
        throw new EastError("Blob is not valid UTF-8", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobDecodeUtf16: (loc_id: bigint, source_map: SourceMap | null) => {
    const decoder_be = new TextDecoder('utf-16be', { fatal: true });
    const decoder_le = new TextDecoder('utf-16le', { fatal: true });
    return (data: Uint8Array) => {
      try {
        if (data.length >= 2) {
          // Check for BOM
          if (data[0] === 0xFE && data[1] === 0xFF) {
            // Big-endian BOM
            return decoder_be.decode(data.subarray(2));
          } else if (data[0] === 0xFF && data[1] === 0xFE) {
            // Little-endian BOM
            return decoder_le.decode(data.subarray(2));
          }
        }
        // No BOM, default to little-endian (not unicode spec compliant, but more common in practice)
        return decoder_le.decode(data);
      } catch {
        throw new EastError("Blob is not valid UTF-16", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobEncodeBeast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const encodeBeast = encodeBeastFor(type);
    return (value: any) => {
      return encodeBeast(value);
    }
  },
  BlobDecodeBeast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const decodeBeast = decodeBeastFor(type);
    return (data: Uint8Array) => {
      try {
        return decodeBeast(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode Beast data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  BlobEncodeBeast2: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const encodeBeast2 = encodeBeast2For(type);
    return (value: any) => {
      return encodeBeast2(value);
    }
  },
  BlobDecodeBeast2: (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], type: EastTypeValue) => {
    const decodeBeast2 = decodeBeast2For(type, { platform: platformDef });
    return (data: Uint8Array) => {
      try {
        return decodeBeast2(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode Beast2 data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  BlobOpenBeast2: (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], type: EastTypeValue) => {
    // The frozen lazy open a runner gives a task input, at the expression
    // level. The header names the wire type (both container versions), and
    // paging or decoding by any other type would read garbage, so a mismatch
    // is an error rather than a decode by the declared type. Whatever cannot
    // page — a v4 container, an index-less blob, cross-segment aliasing, a
    // gated element shape — decodes whole, frozen, with the same semantics.
    // The whole decoder is built on first use: a paged blob never needs it.
    let whole: ((data: Uint8Array) => unknown) | null = null;
    const open = openBeast2LazyFor(type, { platform: platformDef, frozen: true });
    const lazySafe = isBeast2LazySafe(type, { frozen: true });
    return (data: Uint8Array) => {
      try {
        // One geometry read answers everything the open needs: the wire
        // type, whether an index exists (it throws otherwise) and whether
        // the segments are self-contained.
        let extents: Beast2Extents | null = null;
        try {
          extents = readBeast2Extents(data);
        } catch {
          extents = null;
        }
        const wire = extents !== null ? extents.typeValue : readBeast2Type(data);
        if (!isTypeValueEqual(wire, type)) {
          throw new Error(`beast2: cannot open a blob of type ${printTypeValue(wire)} as ${printTypeValue(type)}`);
        }
        if (lazySafe && extents !== null && extents.selfContained) return open(data);
        whole ??= decodeBeast2For(type, { platform: platformDef, frozen: true });
        return whole(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to open Beast2 data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobDecodeCsv: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], structType: EastTypeValue, _configType: EastTypeValue) => {
    return (data: Uint8Array, config: any) => {
      try {
        const decoder = decodeCsvFor(structType, config);
        return decoder(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode CSV data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  ArrayEncodeCsv: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], structType: EastTypeValue, _configType: EastTypeValue) => {
    return (data: any[], config: any) => {
      try {
        const encoder = encodeCsvFor(structType, config);
        return encoder(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to encode CSV data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
} satisfies BuiltinEvaluators;

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, BooleanType, IntegerType, StringType, StructType, type ValueTypeOf } from '@elaraai/east';
import { HubOwnerType } from './control.js';
import { RackLogChunkType } from './rack-wire.js';

/** Forwards an opaque lease to its repository-owning session. */
export const LeaseDataType = StructType({ leaseJson: StringType });
/** Records a newly claimed attempt, owned by the hub's process. */
export const LeaseRunningType = StructType({ leaseJson: StringType, owner: HubOwnerType });
/** Ends an attempt without treating infrastructure loss as a task failure. */
export const LeaseStoppedType = StructType({ leaseJson: StringType, cancelled: BooleanType, cause: StringType });
/** Records a current-protocol agent result. */
export const LeaseOutcomeType = StructType({ leaseJson: StringType, resultJson: StringType });
/** Verifies a complete output graph, not only its root object. */
export const VerifyOutputType = StructType({ hash: StringType });
/** Re-references immutable objects before the hub returns a held target. */
export const TouchObjectsType = ArrayType(StringType);
/** Delivers an ordered log batch and flushes it before acknowledging. */
export const SessionLogsType = StructType({ taskHash: StringType, inputsHash: StringType, executionId: StringType, chunks: ArrayType(RackLogChunkType) });
/** Binds a staged upload and receipt to exactly one lease, hash and size. */
export const SessionUploadType = StructType({ leaseId: StringType, hash: StringType, size: IntegerType, receipt: StringType });
/** An upload declaration, derived from the session wire. */
export type SessionUpload = ValueTypeOf<typeof SessionUploadType>;
/** Temporary transfer state; retained across session takeover, never across a hub restart. */
export const SessionUploadStateType = StructType({ declaration: SessionUploadType, fileId: StringType, committed: BooleanType });

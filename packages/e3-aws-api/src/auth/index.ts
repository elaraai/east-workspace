/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

export { createDiscoveryRoutes } from './discovery.js';
export { createDeviceFlowRoutes } from './device-flow.js';
export {
  extractIdentity,
  CognitoWhoamiBackend,
  lookupUserByEmail,
  type CognitoUser,
} from './cognito-identity.js';

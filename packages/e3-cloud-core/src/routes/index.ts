/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud-agnostic route factories for e3 Cloud Platform.
 *
 * These routes use dependency injection (IdentityBackend, AclStore, etc.)
 * to remain portable across cloud providers.
 */

export { createAuthzMiddleware } from './authz-middleware.js';
export { createAdminRoutes } from './admin-routes.js';
export { createRepoRoutes, deleteSchedulesForRepo, deleteScheduleForWorkspace } from './repo-routes.js';
export { createDataflowRoutes } from './dataflow-routes.js';
export { createScheduleRoutes, createScheduleListRoute, unixCronToAws, validateCron } from './schedule-routes.js';
export { createTaskConfigRoutes } from './task-config-routes.js';
export { createGcRoutes } from './gc-routes.js';

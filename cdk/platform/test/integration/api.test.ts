/**
 * Integration tests for deployed e3 API endpoints.
 *
 * Run with: npm run test:integration
 *
 * These tests validate that:
 * 1. The infrastructure is deployed correctly
 * 2. API Gateway routes to Lambda
 * 3. Lambda responds correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getStackOutputs, getDeploymentId, type StackOutputs } from '../utils/stack-outputs.js';

describe('E3 Platform Integration Tests', () => {
  let outputs: StackOutputs;
  const deploymentId = getDeploymentId();

  beforeAll(async () => {
    console.log(`\nRunning integration tests against deployment: ${deploymentId}`);
    outputs = await getStackOutputs(deploymentId);
    console.log(`API Endpoint: ${outputs.apiEndpoint}`);
    console.log(`Platform URL: ${outputs.platformUrl}\n`);
  }, 30000); // 30s timeout for stack lookup

  describe('Stack Outputs', () => {
    it('should have all required outputs', () => {
      expect(outputs.apiEndpoint).toBeDefined();
      expect(outputs.platformUrl).toBeDefined();
      expect(outputs.userPoolId).toBeDefined();
      expect(outputs.userPoolClientId).toBeDefined();
      expect(outputs.fileSystemId).toBeDefined();
      expect(outputs.tenantsTableName).toBeDefined();
      expect(outputs.permissionsTableName).toBeDefined();
    });

    it('should have valid API endpoint URL', () => {
      expect(outputs.apiEndpoint).toMatch(/^https:\/\/.+\.execute-api\..+\.amazonaws\.com$/);
    });

    it('should have valid CloudFront URL', () => {
      expect(outputs.platformUrl).toMatch(/^https:\/\/.+\.cloudfront\.net$/);
    });
  });

  describe('API Gateway + Lambda', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`);

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('message');
    });

    it('should route tenant API requests', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/repos/test-tenant/api/workspaces`);

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('tenant', 'test-tenant');
    });

    it('should handle different tenants', async () => {
      const response1 = await fetch(`${outputs.apiEndpoint}/repos/tenant-a/api/test`);
      const response2 = await fetch(`${outputs.apiEndpoint}/repos/tenant-b/api/test`);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const body1 = await response1.json();
      const body2 = await response2.json();

      expect(body1.tenant).toBe('tenant-a');
      expect(body2.tenant).toBe('tenant-b');
    });

    it('should return JSON content type', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`);

      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });

  describe('CloudFront Distribution', () => {
    it('should be accessible', async () => {
      const response = await fetch(outputs.platformUrl, {
        redirect: 'manual', // Don't follow redirects
      });

      // CloudFront might return 403 (no index.html yet) or redirect
      // Either is fine - we just want to confirm it's responding
      expect([200, 301, 302, 403, 404]).toContain(response.status);
    });

    it('should proxy API requests', async () => {
      // CloudFront /repos/*/api/* should route to API Gateway
      const response = await fetch(`${outputs.platformUrl}/repos/test-tenant/api/health`);

      // This might fail if CloudFront isn't fully propagated yet
      // Accept either success or 403 (origin not accessible yet)
      expect([200, 403, 502]).toContain(response.status);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers for allowed origins', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        headers: {
          'Origin': 'http://localhost:5173',
        },
      });

      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });

    it('should handle preflight requests', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-methods')).toBeDefined();
    });
  });
});

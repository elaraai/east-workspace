/**
 * Integration tests for deployed e3 API endpoints.
 *
 * Run with: npm run test:integration
 *
 * These tests validate that:
 * 1. The infrastructure is deployed correctly
 * 2. API Gateway routes to Lambda correctly
 * 3. Public endpoints work without authentication
 * 4. Protected endpoints require authentication
 * 5. CloudFront properly routes requests
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
      // Storage
      expect(outputs.dataBucketName).toBeDefined();
      expect(outputs.dataTableName).toBeDefined();

      // Auth
      expect(outputs.userPoolId).toBeDefined();
      expect(outputs.userPoolClientId).toBeDefined();
      expect(outputs.cognitoIssuer).toBeDefined();
      expect(outputs.cognitoDomain).toBeDefined();

      // API
      expect(outputs.apiEndpoint).toBeDefined();

      // Compute
      expect(outputs.taskStateMachineArn).toBeDefined();
      expect(outputs.dataflowStateMachineArn).toBeDefined();
      expect(outputs.deleteRepoStateMachineArn).toBeDefined();
      expect(outputs.gcStateMachineArn).toBeDefined();

      // Frontend
      expect(outputs.appsBucketName).toBeDefined();
      expect(outputs.distributionId).toBeDefined();
      expect(outputs.platformUrl).toBeDefined();
    });

    it('should have valid API endpoint URL', () => {
      expect(outputs.apiEndpoint).toMatch(/^https:\/\/.+\.execute-api\..+\.amazonaws\.com$/);
    });

    it('should have valid Platform URL', () => {
      // Could be CloudFront domain or custom domain
      expect(outputs.platformUrl).toMatch(/^https:\/\/.+/);
    });
  });

  describe('Health Check (Public)', () => {
    it('should respond to health check via API Gateway', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('should respond to health check via CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/health`);

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('OIDC Discovery (Public)', () => {
    it('should return OIDC configuration', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/.well-known/openid-configuration`);

      expect(response.status).toBe(200);

      const config = await response.json();
      expect(config.issuer).toBeDefined();
      expect(config.device_authorization_endpoint).toBeDefined();
      expect(config.token_endpoint).toBeDefined();
      expect(config.jwks_uri).toBeDefined();
      expect(config.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:device_code');
    });

    it('should return OIDC configuration via CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/.well-known/openid-configuration`);

      expect(response.status).toBe(200);

      const config = await response.json();
      expect(config.issuer).toBeDefined();
    });
  });

  describe('Device Flow Endpoints (Public)', () => {
    it('should accept device authorization request', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/oauth2/device_authorization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=test',
      });

      // Should return 200 with device code, or 400 if client_id invalid
      expect([200, 400]).toContain(response.status);
    });

    it('should serve device approval page', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/device`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    });
  });

  describe('Protected Endpoints (Require Auth)', () => {
    it('should require authentication for repo list', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos`);

      // API Gateway JWT authorizer returns 401
      expect(response.status).toBe(401);
    });

    it('should require authentication for repo operations', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos/test-repo/packages`);

      expect(response.status).toBe(401);
    });

    it('should require authentication for workspace operations', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos/test-repo/workspaces`);

      expect(response.status).toBe(401);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers for allowed origins', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });

    it('should handle preflight requests', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/api/repos`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-methods')).toBeDefined();
      expect(response.headers.get('access-control-allow-headers')).toBeDefined();
    });

    it('should allow credentials for allowed origins', async () => {
      const response = await fetch(`${outputs.apiEndpoint}/health`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });
  });

  describe('CloudFront Distribution', () => {
    it('should route API requests through CloudFront', async () => {
      const response = await fetch(`${outputs.platformUrl}/api/repos`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
        },
      });

      // CloudFront should forward to API Gateway
      expect(response.status).toBe(204);
    });

    it('should serve frontend for root path', async () => {
      const response = await fetch(outputs.platformUrl, {
        redirect: 'manual',
      });

      // Might be 200 (index.html), 403 (no index.html yet), or redirect
      expect([200, 301, 302, 403, 404]).toContain(response.status);
    });
  });
});

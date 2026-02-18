/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cognito Test Users Construct
 *
 * Creates test users in Cognito for integration testing via a Custom Resource.
 * Passwords are stored securely in Secrets Manager.
 *
 * Test users created:
 * - owner@{emailDomain} - Repository owner
 * - member@{emailDomain} - Repository member
 * - outsider@{emailDomain} - User with no repo access
 * - admin@{emailDomain} - Platform administrator (in e3-admins group)
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * Test user identifiers (must match e3-cloud-tests TestUserId type).
 */
export const TEST_USER_IDS = ['owner', 'member', 'outsider', 'admin'] as const;
export type TestUserId = typeof TEST_USER_IDS[number];

export interface CognitoTestUsersProps {
  /**
   * The Cognito User Pool to create test users in.
   */
  userPool: cognito.IUserPool;

  /**
   * Email domain for test user addresses.
   * @default 'test.elaraai.com'
   */
  emailDomain?: string;

  /**
   * Resource prefix for naming (e.g., 'e3-dev').
   */
  prefix: string;

  /**
   * The admin group to add the admin user to.
   */
  adminGroup: cognito.CfnUserPoolGroup;
}

/**
 * CDK Construct that creates test users in Cognito for integration testing.
 *
 * This construct:
 * 1. Creates a Secrets Manager secret to store test user passwords
 * 2. Uses a Custom Resource Lambda to:
 *    - Generate random passwords meeting Cognito policy
 *    - Create users with AdminCreateUser (MessageAction: SUPPRESS)
 *    - Set permanent passwords with AdminSetUserPassword
 *    - Add admin user to e3-admins group
 *    - Store passwords in Secrets Manager
 * 3. On stack deletion, deletes the test users
 */
export class CognitoTestUsers extends Construct {
  /**
   * ARN of the Secrets Manager secret containing test user passwords.
   * Secret value is JSON: { "owner": "pass1", "member": "pass2", ... }
   */
  public readonly secretArn: string;

  /**
   * The Secrets Manager secret containing test user passwords.
   */
  public readonly secret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: CognitoTestUsersProps) {
    super(scope, id);

    const { userPool, prefix, adminGroup } = props;
    const emailDomain = props.emailDomain ?? 'test.elaraai.com';

    // Create secret for storing test user passwords
    // Initial value is a placeholder - Custom Resource will update it
    const secret = new secretsmanager.Secret(this, 'TestUserSecret', {
      secretName: `${prefix}-test-users`,
      description: 'Test user passwords for e3 integration testing',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.secret = secret;
    this.secretArn = secret.secretArn;

    // Lambda function for Custom Resource
    const handler = new lambda.Function(this, 'Handler', {
      functionName: `${prefix}-test-users-provisioner`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      code: lambda.Code.fromInline(this.getHandlerCode()),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        SECRET_ARN: secret.secretArn,
        EMAIL_DOMAIN: emailDomain,
        ADMIN_GROUP_NAME: adminGroup.groupName ?? 'e3-admins',
      },
    });

    // Grant permissions to the handler
    secret.grantWrite(handler);
    secret.grantRead(handler);

    // Grant Cognito admin permissions
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminGetUser',
      ],
      resources: [userPool.userPoolArn],
    }));

    // Custom Resource Provider
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: handler,
    });

    // Custom Resource that triggers user creation
    new cdk.CustomResource(this, 'TestUsers', {
      serviceToken: provider.serviceToken,
      properties: {
        // Include these to trigger updates when they change
        userPoolId: userPool.userPoolId,
        emailDomain,
        // Force update on each deployment to refresh passwords if needed
        timestamp: Date.now().toString(),
      },
    });
  }

  /**
   * Inline Lambda handler code for the Custom Resource.
   */
  private getHandlerCode(): string {
    return `
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const {
  SecretsManagerClient,
  PutSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const crypto = require('crypto');

const cognito = new CognitoIdentityProviderClient({});
const secrets = new SecretsManagerClient({});

const TEST_USERS = ['owner', 'member', 'outsider', 'admin'];

/**
 * Generate a random password meeting Cognito policy.
 * Requirements: 12+ chars, uppercase, lowercase, digit, symbol
 */
function generatePassword() {
  const length = 16;
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|';
  const all = lowercase + uppercase + digits + symbols;

  // Ensure at least one of each required character type
  let password = '';
  password += lowercase[crypto.randomInt(lowercase.length)];
  password += uppercase[crypto.randomInt(uppercase.length)];
  password += digits[crypto.randomInt(digits.length)];
  password += symbols[crypto.randomInt(symbols.length)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += all[crypto.randomInt(all.length)];
  }

  // Shuffle the password
  return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

/**
 * Check if a user exists in Cognito.
 */
async function userExists(userPoolId, username) {
  try {
    await cognito.send(new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }));
    return true;
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      return false;
    }
    throw err;
  }
}

/**
 * Create a test user in Cognito.
 */
async function createUser(userPoolId, userId, email, password) {
  const username = email;

  // Check if user already exists
  if (await userExists(userPoolId, username)) {
    console.log(\`User \${username} already exists, updating password\`);
  } else {
    // Create user (suppresses welcome email)
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: \`Test \${userId.charAt(0).toUpperCase() + userId.slice(1)}\` },
      ],
      MessageAction: 'SUPPRESS',
    }));
    console.log(\`Created user \${username}\`);
  }

  // Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: username,
    Password: password,
    Permanent: true,
  }));
  console.log(\`Set password for \${username}\`);
}

/**
 * Delete a test user from Cognito.
 */
async function deleteUser(userPoolId, email) {
  try {
    await cognito.send(new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    }));
    console.log(\`Deleted user \${email}\`);
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      console.log(\`User \${email} not found, skipping delete\`);
    } else {
      throw err;
    }
  }
}

/**
 * Add user to admin group.
 */
async function addToAdminGroup(userPoolId, email, groupName) {
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: email,
    GroupName: groupName,
  }));
  console.log(\`Added \${email} to group \${groupName}\`);
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const userPoolId = process.env.USER_POOL_ID;
  const secretArn = process.env.SECRET_ARN;
  const emailDomain = process.env.EMAIL_DOMAIN;
  const adminGroupName = process.env.ADMIN_GROUP_NAME;

  const requestType = event.RequestType;

  try {
    if (requestType === 'Create' || requestType === 'Update') {
      // Generate passwords for all test users
      const passwords = {};
      for (const userId of TEST_USERS) {
        passwords[userId] = generatePassword();
      }

      // Create users in Cognito
      for (const userId of TEST_USERS) {
        const email = \`\${userId}@\${emailDomain}\`;
        await createUser(userPoolId, userId, email, passwords[userId]);

        // Add admin user to admin group
        if (userId === 'admin') {
          await addToAdminGroup(userPoolId, email, adminGroupName);
        }
      }

      // Store passwords in Secrets Manager
      await secrets.send(new PutSecretValueCommand({
        SecretId: secretArn,
        SecretString: JSON.stringify(passwords),
      }));
      console.log('Stored passwords in Secrets Manager');

      return {
        PhysicalResourceId: \`test-users-\${userPoolId}\`,
        Data: {
          UserCount: TEST_USERS.length,
        },
      };
    } else if (requestType === 'Delete') {
      // Delete test users
      for (const userId of TEST_USERS) {
        const email = \`\${userId}@\${emailDomain}\`;
        await deleteUser(userPoolId, email);
      }

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      };
    }

    return {
      PhysicalResourceId: event.PhysicalResourceId || 'unknown',
    };
  } catch (err) {
    console.error('Error:', err);
    throw err;
  }
};
`;
  }
}

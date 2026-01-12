/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cross-Account Route53 Record Construct
 *
 * Creates Route53 records in a hosted zone that may be in a different AWS account.
 * Uses IAM role assumption for cross-account access.
 */

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface CrossAccountRoute53RecordProps {
  /**
   * The full domain name for the record (e.g., "dev.e3.elaraai.com").
   */
  recordName: string;

  /**
   * Route53 Hosted Zone ID where the record should be created.
   */
  hostedZoneId: string;

  /**
   * The target for the alias record (CloudFront distribution domain name).
   */
  aliasTarget: string;

  /**
   * The hosted zone ID for the alias target (CloudFront's hosted zone ID).
   * For CloudFront, this is always Z2FDTNDATAQYW2.
   */
  aliasHostedZoneId: string;

  /**
   * Optional: IAM role ARN to assume for cross-account Route53 access.
   * If not provided, uses the current account's permissions.
   */
  route53RoleArn?: string;

  /**
   * Optional: Removal policy for the record.
   * @default RemovalPolicy.DESTROY
   */
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Creates a Route53 alias record, supporting cross-account hosted zones.
 */
export class CrossAccountRoute53Record extends Construct {
  constructor(scope: Construct, id: string, props: CrossAccountRoute53RecordProps) {
    super(scope, id);

    const { recordName, hostedZoneId, aliasTarget, aliasHostedZoneId, route53RoleArn, removalPolicy } = props;

    // Log group for the handler
    const logGroup = new logs.LogGroup(this, 'HandlerLogs', {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for Route53 record management
    const recordHandler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      logGroup,
      code: lambda.Code.fromInline(`
const { Route53Client, ChangeResourceRecordSetsCommand, GetChangeCommand } = require('@aws-sdk/client-route-53');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');

const sts = new STSClient({});

async function getRoute53Client(roleArn) {
  if (!roleArn) {
    return new Route53Client({});
  }

  const assumeResult = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'CrossAccountRoute53Record',
  }));

  return new Route53Client({
    credentials: {
      accessKeyId: assumeResult.Credentials.AccessKeyId,
      secretAccessKey: assumeResult.Credentials.SecretAccessKey,
      sessionToken: assumeResult.Credentials.SessionToken,
    },
  });
}

async function waitForChange(route53, changeId) {
  for (let i = 0; i < 60; i++) {
    const result = await route53.send(new GetChangeCommand({ Id: changeId }));
    if (result.ChangeInfo.Status === 'INSYNC') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Timed out waiting for Route53 change to propagate');
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { RecordName, HostedZoneId, AliasTarget, AliasHostedZoneId, Route53RoleArn } = event.ResourceProperties;
  const requestType = event.RequestType;

  const route53 = await getRoute53Client(Route53RoleArn || null);

  if (requestType === 'Create' || requestType === 'Update') {
    const result = await route53.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId,
      ChangeBatch: {
        Comment: 'Managed by CDK CrossAccountRoute53Record',
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: RecordName,
            Type: 'A',
            AliasTarget: {
              DNSName: AliasTarget,
              HostedZoneId: AliasHostedZoneId,
              EvaluateTargetHealth: false,
            },
          },
        }],
      },
    }));

    console.log('Route53 change initiated:', result.ChangeInfo.Id);
    await waitForChange(route53, result.ChangeInfo.Id);
    console.log('Route53 change complete');

    return {
      PhysicalResourceId: RecordName,
      Data: { RecordName },
    };
  }

  if (requestType === 'Delete') {
    try {
      const result = await route53.send(new ChangeResourceRecordSetsCommand({
        HostedZoneId,
        ChangeBatch: {
          Comment: 'Cleanup by CDK CrossAccountRoute53Record',
          Changes: [{
            Action: 'DELETE',
            ResourceRecordSet: {
              Name: RecordName,
              Type: 'A',
              AliasTarget: {
                DNSName: AliasTarget,
                HostedZoneId: AliasHostedZoneId,
                EvaluateTargetHealth: false,
              },
            },
          }],
        },
      }));

      console.log('Route53 delete initiated:', result.ChangeInfo.Id);
      await waitForChange(route53, result.ChangeInfo.Id);
      console.log('Route53 delete complete');
    } catch (e) {
      console.log('Error during delete (may not exist):', e.message);
    }

    return {
      PhysicalResourceId: event.PhysicalResourceId,
    };
  }
};
`),
    });

    // Grant permissions
    if (route53RoleArn) {
      // Cross-account: grant permission to assume the provided role
      recordHandler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [route53RoleArn],
        })
      );
    } else {
      // Same account: grant direct Route53 access
      recordHandler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'route53:ChangeResourceRecordSets',
            'route53:GetChange',
          ],
          resources: [
            `arn:aws:route53:::hostedzone/${hostedZoneId}`,
            'arn:aws:route53:::change/*',
          ],
        })
      );
    }

    // Custom resource provider
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: recordHandler,
    });

    // Custom resource for the record
    new cdk.CustomResource(this, 'Record', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::CrossAccountRoute53Record',
      properties: {
        RecordName: recordName,
        HostedZoneId: hostedZoneId,
        AliasTarget: aliasTarget,
        AliasHostedZoneId: aliasHostedZoneId,
        Route53RoleArn: route53RoleArn ?? '',
      },
      removalPolicy: removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });
  }
}

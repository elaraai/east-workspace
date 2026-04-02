/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly fileSystem: efs.IFileSystem;
  public readonly tenantsTable: dynamodb.ITable;
  public readonly permissionsTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC for EFS access
    this.vpc = new ec2.Vpc(this, 'E3Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // EFS for repository storage
    this.fileSystem = new efs.FileSystem(this, 'E3FileSystem', {
      vpc: this.vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Tenants table
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: 'e3-tenants',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Permissions table
    this.permissionsTable = new dynamodb.Table(this, 'PermissionsTable', {
      tableName: 'e3-permissions',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: Lookup permissions by tenant
    this.permissionsTable.addGlobalSecondaryIndex({
      indexName: 'TenantIndex',
      partitionKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'FileSystemId', { value: this.fileSystem.fileSystemId });
    new cdk.CfnOutput(this, 'TenantsTableName', { value: this.tenantsTable.tableName });
    new cdk.CfnOutput(this, 'PermissionsTableName', { value: this.permissionsTable.tableName });
  }
}

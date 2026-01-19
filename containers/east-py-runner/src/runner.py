"""
East-py Task Runner

Fargate container that polls SQS for tasks and executes them using east-py CLI.
Implements task claim tracking with heartbeat to handle long-running tasks.

Environment variables:
- TASK_QUEUE_URL: SQS queue URL for task dispatch
- BUCKET_NAME: S3 bucket for data storage
- TABLE_NAME: DynamoDB table for state
- AWS_REGION: AWS region (auto-detected from ECS metadata)
"""

import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Configuration from environment
TASK_QUEUE_URL = os.environ.get("TASK_QUEUE_URL", "")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
TABLE_NAME = os.environ.get("TABLE_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "ap-southeast-2")

# Container ID (unique per container instance)
CONTAINER_ID = os.environ.get("HOSTNAME", str(uuid.uuid4())[:8])

# Heartbeat interval (seconds)
HEARTBEAT_INTERVAL = 60

# SQS long poll timeout (seconds)
SQS_WAIT_TIME = 20

# Initialize AWS clients
sqs = boto3.client("sqs", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)
dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)

# Graceful shutdown flag
shutdown_requested = False


def signal_handler(signum: int, frame: Any) -> None:
    """Handle shutdown signals gracefully."""
    global shutdown_requested
    logger.info(f"Received signal {signum}, initiating graceful shutdown")
    shutdown_requested = True


# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


def claim_task(repo: str, execution_id: str, task_name: str) -> bool:
    """
    Attempt to claim a task for execution.

    Uses conditional write to prevent duplicate execution.
    Returns True if claim successful, False if already claimed.
    """
    now_ms = int(time.time() * 1000)

    try:
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": f"REPO#{repo}"},
                "SK": {"S": f"EXEC#TASK#{execution_id}#{task_name}"},
                "status": {"S": "running"},
                "claimedBy": {"S": CONTAINER_ID},
                "claimedAt": {"N": str(now_ms)},
                "heartbeat": {"N": str(now_ms)},
            },
            ConditionExpression="attribute_not_exists(SK) OR #status = :dispatched",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":dispatched": {"S": "dispatched"}},
        )
        logger.info(f"Claimed task {task_name}")
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            logger.warning(f"Task {task_name} already claimed by another container")
            return False
        raise


def extend_claim(repo: str, execution_id: str, task_name: str) -> bool:
    """
    Extend task claim by updating heartbeat timestamp.

    Returns True if heartbeat successful, False if claim lost.
    """
    now_ms = int(time.time() * 1000)

    try:
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={
                "PK": {"S": f"REPO#{repo}"},
                "SK": {"S": f"EXEC#TASK#{execution_id}#{task_name}"},
            },
            UpdateExpression="SET heartbeat = :now",
            ConditionExpression="claimedBy = :container AND #status = :running",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":now": {"N": str(now_ms)},
                ":container": {"S": CONTAINER_ID},
                ":running": {"S": "running"},
            },
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            logger.warning(f"Lost claim on task {task_name}")
            return False
        raise


def mark_task_success(
    repo: str, execution_id: str, task_name: str, output_hash: str, duration_ms: int
) -> None:
    """Mark task as successfully completed."""
    dynamodb.update_item(
        TableName=TABLE_NAME,
        Key={
            "PK": {"S": f"REPO#{repo}"},
            "SK": {"S": f"EXEC#TASK#{execution_id}#{task_name}"},
        },
        UpdateExpression="SET #status = :status, outputHash = :hash, #duration = :duration, completedAt = :now",
        ExpressionAttributeNames={"#status": "status", "#duration": "duration"},
        ExpressionAttributeValues={
            ":status": {"S": "success"},
            ":hash": {"S": output_hash},
            ":duration": {"N": str(duration_ms)},
            ":now": {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        },
    )
    logger.info(f"Marked task {task_name} as success with output {output_hash}")


def mark_task_failed(
    repo: str,
    execution_id: str,
    task_name: str,
    exit_code: int,
    error: str,
    duration_ms: int,
) -> None:
    """Mark task as failed."""
    dynamodb.update_item(
        TableName=TABLE_NAME,
        Key={
            "PK": {"S": f"REPO#{repo}"},
            "SK": {"S": f"EXEC#TASK#{execution_id}#{task_name}"},
        },
        UpdateExpression="SET #status = :status, exitCode = :code, #error = :error, #duration = :duration, failedAt = :now",
        ExpressionAttributeNames={
            "#status": "status",
            "#error": "error",
            "#duration": "duration",
        },
        ExpressionAttributeValues={
            ":status": {"S": "failed"},
            ":code": {"N": str(exit_code)},
            ":error": {"S": error[:1000]},  # Truncate error message
            ":duration": {"N": str(duration_ms)},
            ":now": {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        },
    )
    logger.warning(f"Marked task {task_name} as failed: {error}")


def download_input(repo: str, hash_value: str, local_path: Path) -> None:
    """Download input object from S3."""
    key = f"{repo}/objects/{hash_value}"
    logger.debug(f"Downloading s3://{BUCKET_NAME}/{key} to {local_path}")
    s3.download_file(BUCKET_NAME, key, str(local_path))


def upload_output(repo: str, local_path: Path) -> str:
    """Upload output object to S3 and return hash."""
    import hashlib

    # Compute hash
    with open(local_path, "rb") as f:
        content = f.read()
    hash_value = hashlib.sha256(content).hexdigest()

    # Upload
    key = f"{repo}/objects/{hash_value}"
    logger.debug(f"Uploading {local_path} to s3://{BUCKET_NAME}/{key}")
    s3.upload_file(str(local_path), BUCKET_NAME, key)

    return hash_value


def run_heartbeat_thread(
    repo: str, execution_id: str, task_name: str, stop_event: threading.Event
) -> None:
    """Background thread to send heartbeats during task execution."""
    while not stop_event.wait(HEARTBEAT_INTERVAL):
        if not extend_claim(repo, execution_id, task_name):
            logger.error(f"Failed to extend claim for {task_name}, stopping heartbeat")
            break


def execute_task(task_msg: dict) -> None:
    """
    Execute a single task.

    1. Claim task in DynamoDB
    2. Download inputs from S3
    3. Run east-py CLI
    4. Upload output to S3
    5. Update DynamoDB status
    """
    repo = task_msg["repo"]
    workspace = task_msg["workspace"]
    execution_id = task_msg["executionId"]
    task_name = task_msg["taskName"]
    task_hash = task_msg["taskHash"]
    input_hashes = task_msg["inputHashes"]
    output_path = task_msg.get("outputPath", "")

    logger.info(f"Executing task {task_name} (hash: {task_hash[:12]}...)")

    # Claim task
    if not claim_task(repo, execution_id, task_name):
        logger.info(f"Skipping task {task_name} - already claimed")
        return

    start_time = time.time()
    stop_heartbeat = threading.Event()

    # Start heartbeat thread
    heartbeat_thread = threading.Thread(
        target=run_heartbeat_thread,
        args=(repo, execution_id, task_name, stop_heartbeat),
        daemon=True,
    )
    heartbeat_thread.start()

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Download task IR (stored as BEAST2 encoded data)
            # The function IR is the first input (input_hashes[0])
            task_ir_path = tmpdir_path / "task.beast2"
            download_input(repo, input_hashes[0], task_ir_path)

            # Download inputs (skip first which is the function IR)
            input_paths = []
            for i, hash_value in enumerate(input_hashes[1:]):
                input_path = tmpdir_path / f"input-{i}"
                download_input(repo, hash_value, input_path)
                input_paths.append(str(input_path))

            # Prepare output path
            output_file = tmpdir_path / "output"

            # Build command
            # TODO: Add east_py_datascience once it supports Python 3.11+
            cmd = [
                "east-py",
                "run",
                str(task_ir_path),
                "-p", "east_py_std",
                "-p", "east_py_io",
            ]

            # Add inputs
            for input_path in input_paths:
                cmd.extend(["-i", input_path])

            # Add output
            cmd.extend(["-o", str(output_file)])

            logger.info(f"Running: {' '.join(cmd)}")

            # Execute task
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600,  # 1 hour timeout
            )

            duration_ms = int((time.time() - start_time) * 1000)

            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Unknown error"
                mark_task_failed(
                    repo, execution_id, task_name, result.returncode, error_msg, duration_ms
                )
                return

            # Upload output
            if output_file.exists():
                output_hash = upload_output(repo, output_file)
                mark_task_success(repo, execution_id, task_name, output_hash, duration_ms)
            else:
                mark_task_failed(
                    repo, execution_id, task_name, 1, "Output file not created", duration_ms
                )

    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - start_time) * 1000)
        mark_task_failed(repo, execution_id, task_name, -1, "Task timed out", duration_ms)
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        mark_task_failed(repo, execution_id, task_name, -1, str(e), duration_ms)
        logger.exception(f"Error executing task {task_name}")
    finally:
        # Stop heartbeat thread
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=5)


def poll_and_execute() -> bool:
    """
    Poll SQS for a task and execute it.

    Returns True if a task was processed, False if queue was empty.
    """
    try:
        response = sqs.receive_message(
            QueueUrl=TASK_QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=SQS_WAIT_TIME,
            AttributeNames=["All"],
            MessageAttributeNames=["All"],
        )

        messages = response.get("Messages", [])
        if not messages:
            return False

        message = messages[0]
        receipt_handle = message["ReceiptHandle"]
        body = json.loads(message["Body"])

        logger.info(f"Received task message: {body.get('taskName', 'unknown')}")

        try:
            execute_task(body)
        finally:
            # Always delete message (success or failure)
            # Failed tasks will be retried via SQS visibility timeout / DLQ
            sqs.delete_message(QueueUrl=TASK_QUEUE_URL, ReceiptHandle=receipt_handle)

        return True

    except Exception:
        logger.exception("Error polling SQS")
        time.sleep(5)  # Back off on error
        return False


def main() -> None:
    """Main entry point."""
    logger.info(f"Starting east-py runner (container: {CONTAINER_ID})")
    logger.info(f"Queue: {TASK_QUEUE_URL}")
    logger.info(f"Bucket: {BUCKET_NAME}")
    logger.info(f"Table: {TABLE_NAME}")

    if not TASK_QUEUE_URL or not BUCKET_NAME or not TABLE_NAME:
        logger.error("Missing required environment variables")
        sys.exit(1)

    while not shutdown_requested:
        poll_and_execute()

    logger.info("Shutdown complete")


if __name__ == "__main__":
    main()

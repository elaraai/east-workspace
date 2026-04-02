# East-py Runner Container
#
# Fargate container that polls SQS for tasks and executes them using east-py CLI.
# Uses warm pool pattern for sub-second task pickup latency.
#
# Build (from e3-aws root, with east-py sibling):
#   docker build -f containers/east-py-runner/Dockerfile \
#     --build-context east-py=../east-py \
#     -t east-py-runner .
#
# Required environment variables:
#   TASK_QUEUE_URL - SQS queue URL for task dispatch
#   BUCKET_NAME - S3 bucket for data storage
#   TABLE_NAME - DynamoDB table for state
#   AWS_REGION - AWS region

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Copy east-py workspace (packages need workspace references)
# This uses Docker's build context feature to access sibling directory
COPY --from=east-py pyproject.toml uv.lock /east-py/
COPY --from=east-py packages/east-py /east-py/packages/east-py
COPY --from=east-py packages/east-py-std /east-py/packages/east-py-std
COPY --from=east-py packages/east-py-io /east-py/packages/east-py-io
COPY --from=east-py packages/east-py-cli /east-py/packages/east-py-cli

# Copy runner application
COPY containers/east-py-runner/pyproject.toml containers/east-py-runner/uv.lock* ./
COPY containers/east-py-runner/src/ ./src/

# Install dependencies from local east-py packages
# TODO: Add east-py-datascience once it uses lazy imports for optional deps
# (currently has numba/llvmlite dep conflict with Python 3.11+)
RUN uv pip install --system boto3>=1.34.0 \
    /east-py/packages/east-py \
    /east-py/packages/east-py-std \
    /east-py/packages/east-py-io \
    /east-py/packages/east-py-cli

# Set Python path
ENV PYTHONPATH=/app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import sys; sys.exit(0)"

# Run the runner
CMD ["python", "-m", "src.runner"]

# AjoAI autonomous agent — always-on worker.
# BUILD CONTEXT = repo root (the agent reads ../config/, so both dirs must ship):
#   docker build -f agent/Dockerfile -t ajoai-agent .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Build deps for any source-built wheels, removed after install to keep the image small.
RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY agent/requirements.txt agent/requirements.txt
RUN pip install -r agent/requirements.txt && apt-get purge -y gcc && apt-get autoremove -y

# REPO_ROOT = parents[2] of agent/src/config.py → /app, so config must sit at /app/config.
COPY agent/ agent/
COPY config/ config/

# Default to mainnet for the hosted agent; override per environment.
ENV CHAIN=mainnet \
    RPC_URL=https://forno.celo.org \
    FEE_CURRENCY=USDm \
    SIMULATE_YIELD=true \
    SIMULATE_SELF=false \
    LOG_LEVEL=info

WORKDIR /app/agent

# Sweep every factory circle every 30s: auto-start full Forming circles, trigger Active ones.
# Idempotent + single-instance safe. The agent pays gas in CELO — keep the account funded.
CMD ["python", "-m", "src.main", "run-all", "30"]

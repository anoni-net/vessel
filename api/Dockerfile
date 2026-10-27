FROM python:3.13-slim
# the API and the worker reach the nodes' awgctl over SSH
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY migrations ./migrations
ENV PATH="/app/.venv/bin:$PATH"
# no access log: the portal does not record visitors' IPs (#433)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]

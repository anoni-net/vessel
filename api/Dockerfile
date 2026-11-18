# the tag moves with every patch release; the digest is what was reviewed. Dependabot proposes the next one
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928
# the API and the worker reach the nodes' awgctl over SSH
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && rm -rf /var/lib/apt/lists/*
# The API and the worker run as this user, not root: a way into the process does not come with root inside the
# container. The SSH key for the nodes is owned by the same uid on the host (deploy/deploy.sh), mode 600. Change both
# together. No home: ssh is told where everything is (app/nodes.py) and writes nothing.
ARG VESSEL_UID=10001
RUN groupadd --system --gid $VESSEL_UID vessel \
 && useradd --system --uid $VESSEL_UID --gid vessel --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin vessel
COPY --from=ghcr.io/astral-sh/uv:0.10.7@sha256:edd1fd89f3e5b005814cc8f777610445d7b7e3ed05361f9ddfae67bebfe8456a /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
# no cache: the packages are installed once, and a copy of each would stay in the image (and in its SBOM).
# Compiled here, since the container's files are read-only (docker-compose.yml) and Python cannot write .pyc there
RUN uv sync --frozen --no-dev --no-install-project --no-cache --compile-bytecode
COPY app ./app
COPY migrations ./migrations
RUN python -m compileall -q app
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
USER $VESSEL_UID:$VESSEL_UID
# no access log: the portal does not record visitors' IPs (#433)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]

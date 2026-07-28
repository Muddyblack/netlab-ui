FROM python:3.11-slim

RUN apt-get update && apt-get install -y git docker.io curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY services ./services
# Install only the optional assistant extra. netlab and Ansible belong to the
# user's lab environment; configure or mount its netlab executable through
# Settings → Environment / NETLAB_BIN. `assistant` brings in mcp, claude-agent-sdk,
#   google-genai, openai). Without it the assistant router never mounts and
#   the AI toolbar button stays hidden — see services/assistant/__init__.py
#   (assistant_enabled) and NETLAB_APP_ASSISTANT.
RUN pip install --no-cache-dir ".[assistant]"

# Install containerlab — netlab's default provider — so `netlab up`, status and
# shell actions work out of the box. The official installer drops the
# `containerlab` binary onto PATH.
RUN bash -c "$(curl -sL https://get.containerlab.dev)"

# NOTE: containerlab drives the host's Docker daemon to create lab nodes, so the
# container must be run with access to a Docker daemon — mount the socket
# (`-v /var/run/docker.sock:/var/run/docker.sock`) or run with `--privileged`.
# libvirt-based providers are still not included.

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# deploy/sandbox/Dockerfile
FROM node:20-alpine

# Install tools the agent will commonly need
RUN apk add --no-cache \
    git bash python3 py3-pip \
    make g++ \
    ripgrep findutils coreutils \
    curl wget \
    && pip3 install --break-system-packages pytest

# Non-root user — UID 1001 (UID 1000 is taken by 'node' user in base image)
RUN addgroup -S goli && adduser -S goli -G goli -u 1001
USER goli
WORKDIR /workspace

# Verify tools
RUN git --version && node --version && python3 --version && rg --version

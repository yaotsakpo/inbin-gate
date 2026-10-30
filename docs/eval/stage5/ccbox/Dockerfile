FROM node:20-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git python3 rsync ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@2.1.197 && useradd -m -s /bin/bash dev
USER dev
WORKDIR /home/dev
COPY --chown=dev:dev repo /home/dev/inbin-gate
RUN cd /home/dev/inbin-gate && npm install --silent && git config --global user.name dev && git config --global user.email dev@example.com \
 && echo '{"hasCompletedOnboarding":true}' > /home/dev/.claude.json && mkdir -p /home/dev/scratch
WORKDIR /home/dev/inbin-gate

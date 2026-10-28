FROM node:20-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@latest && useradd -m -s /bin/bash dev
USER dev
WORKDIR /home/dev
RUN git config --global user.name dev && git config --global user.email dev@example.com && echo '{"hasCompletedOnboarding":true}' > /home/dev/.claude.json

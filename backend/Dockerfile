# ---------- stage 1: compile the C engine ----------
FROM debian:bookworm-slim AS cbuild
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY c/ ./c/
RUN mkdir -p bin && gcc -O2 -Wall -o bin/ipo c/ipo.c c/unbuf.c

# ---------- stage 2: Node.js API ----------
FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY --from=cbuild /src/bin/ipo ./bin/ipo
ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["node", "server.js"]

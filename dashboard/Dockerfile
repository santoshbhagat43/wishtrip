FROM node:24-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
# Development server; src/ is mounted by docker-compose for live reload.
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

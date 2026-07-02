# One shared image for every Bun service in the monorepo. Each Render service
# runs the same image and overrides the start command via `dockerCommand` in
# render.yaml, so we build once and fan out to backend / workers / web.
FROM oven/bun:1.3.6

WORKDIR /app

# .dockerignore keeps host node_modules and .env out of the context, so this is
# a clean, reproducible install straight from the committed lockfile.
COPY . .
RUN bun install --frozen-lockfile

# The Prisma client is committed under packages/db/generated, so there is no
# generate step here. Bun also skips dependency postinstall scripts by default,
# which is why the committed client is required at runtime.

# Overridden per service in render.yaml; this default is just a sane fallback.
CMD ["bun", "run", "apps/backend/index.ts"]

# One shared image for every Bun service in the monorepo. Each Render service
# runs the same image and overrides the start command via `dockerCommand` in
# render.yaml, so we build once and fan out to backend / workers / web.
FROM oven/bun:1.3.6

WORKDIR /app

# .dockerignore keeps host node_modules and .env out of the context, so this is
# a clean, reproducible install straight from the committed lockfile.
COPY . .
RUN bun install --frozen-lockfile

# The generated Prisma client is gitignored (not in the repo), so generate it
# inside the image. The dummy DATABASE_URL just satisfies prisma.config.ts's
# env("DATABASE_URL") — `generate` produces the client and never connects.
RUN cd packages/db && DATABASE_URL="postgresql://x:x@localhost:5432/x" bun --bun run prisma generate

# Overridden per service via the Docker Command; this default is a sane fallback.
CMD ["bun", "run", "apps/backend/index.ts"]

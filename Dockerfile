# syntax=docker/dockerfile:1

# Bookr — production image.
#
# Two-stage build: the first stage installs the full pnpm workspace, compiles every package,
# and produces a self-contained, pruned copy of the server package (workspace dependencies
# resolved to real files, not symlinks). The second stage is a minimal runtime image that
# never sees dev dependencies, the workspace source tree, a browser, or a compiler toolchain.
#
# Both stages pin the same glibc base (Debian "bookworm" slim) because the sqlite bindings this
# app depends on ship prebuilt binaries for glibc, not musl (so this deliberately is not an
# Alpine image).

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Stage: build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /workspace

# Native-module toolchain: covers any dependency that falls back to compiling from source when
# no prebuilt binary matches the container's architecture/libc. Kept in this stage only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# pnpm ships via Corepack (bundled with Node); pin the exact version instead of trusting
# whatever Corepack would otherwise fetch at build time.
ARG PNPM_VERSION=9.15.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# The Bitwarden CLI backs the optional "vaultwarden" credentials provider (see the server's
# credentials adapter). Installing it here means the runtime image always has `bw` on PATH
# regardless of which provider a given deployment selects at runtime via env.
RUN npm install --global @bitwarden/cli

# Install dependencies first so this layer is cached across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
RUN pnpm install --frozen-lockfile

# Compile every workspace package (each package's own "build" script decides what, if
# anything, it needs to emit; packages without one are skipped).
RUN pnpm -r build

# Produce a pruned, production-only copy of the server package: its own compiled output plus
# every workspace dependency it needs, with production dependencies installed and
# devDependencies excluded. pnpm resolves workspace:* dependencies here to real copies, not
# symlinks back into /workspace, so the result is portable on its own.
RUN pnpm --filter @bookr/server --prod deploy /prod/server

# The web dashboard has no server-side runtime component — its build output is static assets
# served by the API process. Copy them out separately so the runtime stage doesn't need the
# rest of the web package (its dev server, source, etc.).
RUN mkdir -p /prod/web-static && cp -r apps/web/dist/. /prod/web-static/

# ---------------------------------------------------------------------------
# Stage: runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Same pinned pnpm/Corepack setup as the build stage, and the same `bw` CLI: the vaultwarden
# credentials provider shells out to it at runtime, so it has to exist here too, not just in
# the build stage.
ARG PNPM_VERSION=9.15.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate \
    && npm install --global @bitwarden/cli \
    && npm cache clean --force

# Run as an unprivileged, dedicated user rather than the image's default root. The user gets
# its own home directory (separate from /app, the application's install directory) because
# tools that shell out at runtime — notably `bw`, for the vaultwarden credentials provider —
# need a writable $HOME to keep their own config/session state in.
RUN groupadd --gid 1001 bookr \
    && useradd --uid 1001 --gid bookr --home-dir /home/bookr --create-home --shell /usr/sbin/nologin bookr

COPY --from=build --chown=bookr:bookr /prod/server ./
COPY --from=build --chown=bookr:bookr /prod/web-static ./public

# Point the server at the bundled dashboard build so it serves the SPA (and its /api mounts the
# static assets). Without this the server runs API-only and browser navigations 404.
ENV WEB_ROOT=/app/public

# Bind-mounted at runtime for the SQLite data file and any other persisted state; created here
# so the non-root user owns it even before a volume is mounted over it.
RUN mkdir -p /app/data && chown bookr:bookr /app/data

USER bookr

# Informational only — the container's actual published port is whatever PORT resolves to
# (see the env contract); compose maps it explicitly rather than relying on this default. Kept
# equal to the app's default PORT (8080) to avoid confusing docs/tooling that read EXPOSE.
EXPOSE 8080

# Uses Node's built-in fetch instead of curl/wget so the runtime image doesn't need either
# installed just for this. Hits the shallow, unauthenticated health endpoint. The fallback port
# matches the app's default PORT so the check works even when PORT is left unset.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'8080')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Assumes the server package's "build" script compiles its entry (currently named "main.ts" in
# source) to "dist/main.js". Update this if the server's build output path/filename differs.
CMD ["node", "dist/main.js"]

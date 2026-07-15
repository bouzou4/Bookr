# Deploying Bookr

Bookr ships as a single container: the REST API, scheduler, and static dashboard build all
live in one image (see the root `Dockerfile`). Everything that varies by deployment —
hostnames, credentials, provider keys, poll cadence — is supplied through environment
variables (`.env.example` at the repo root documents the full contract). Nothing
deployment-specific belongs in the image, `docker-compose.yml`, or any committed file.

## Building and running

```sh
cp .env.example .env   # fill in the values for your environment
docker compose build
docker compose up -d
```

`docker-compose.yml` builds the image locally by default (`build: .`) and also tags it as
`${BOOKR_IMAGE:-bookr:latest}`, so you can instead build once and reference a registry image
by setting `BOOKR_IMAGE` if you'd rather not rebuild on every host.

The service listens on `PORT` (from `.env`) and expects to reach any reverse proxy through a
pre-existing Docker network — the compose file calls this placeholder network `proxy-net`
(`external: true`); rename it to whatever network your proxy's containers already share, or
delete the `networks:` blocks and uncomment the `ports:` mapping if you're not running behind
a reverse proxy at all.

Application data (the SQLite database, session store, etc.) is bind-mounted from
`${BOOKR_DATA_DIR:-./data}` on the host into `/app/data` in the container, so it survives
container recreation. Back this path up like you would any database file.

## Reverse proxy

If you front Bookr with an nginx reverse proxy that routes by a `map $host $backend {...}`
host table (one config, one line per proxied service), the line to add is:

```nginx
    dashboard.example.com    <bookr-container-address>:<PORT>;
```

Replace `dashboard.example.com` with the hostname you want the dashboard reachable at, and
`<bookr-container-address>:<PORT>` with wherever the `bookr` service is reachable from the
proxy (a container name, a static IP on the shared Docker network, or a host:port if you
published the port instead). Bookr sets `trust proxy 1` and expects the proxy to terminate
TLS and forward plain HTTP; the session cookie is `Secure`, so the app must be reached over
HTTPS end-to-end from the client's perspective.

## Deploying via Portainer (or any Compose-based stack manager)

Bookr's `docker-compose.yml` is a plain Compose file with no Portainer-specific extensions,
so it works as a standard Portainer **stack**:

1. Create a new stack from this repository (Git-backed stack, pointed at this repo/branch —
   easiest way to get updates on redeploy) or paste the compose file directly.
2. Set the stack's environment variables to match `.env.example` (Portainer stacks have an
   "Environment variables" section for exactly this — you do not need to ship a `.env` file
   if you set them there instead).
3. Attach the stack to whatever external network your reverse proxy uses, if any (see above);
   create that network first if it doesn't already exist (`docker network create <name>`) —
   Portainer stacks can join a network they didn't create as long as it's marked external.
4. Point the bind-mounted data volume at a path on the host that Portainer's agent/node can
   write to, and that you include in your backup routine.
5. Redeploy the stack after any `.env`/environment-variable change; the container itself has
   no persistent state outside `/app/data`, so recreation is safe.

## Secrets to provision before first deploy

Bookr never stores secrets in source, fixtures, logs, or the image — they're supplied
entirely through the environment variables listed in `.env.example`. Pick **one** of the two
credentials strategies below (`CREDENTIALS_PROVIDER` selects it) and provision the
corresponding secrets wherever you manage deployment secrets (Portainer stack environment
variables, a secrets manager, or a local `.env` file that is never committed):

**Option A — `CREDENTIALS_PROVIDER=env`** (simplest; no external dependency):

- `CRED_<PROVIDER>_USERNAME`, `CRED_<PROVIDER>_PASSWORD` (and `CRED_<PROVIDER>_API_KEY` where
  applicable) per booking provider you enable — e.g. `CRED_RESY_USERNAME`.
- `INGEST_TOKEN` — bearer token guarding the session-handoff ingest endpoint.
- `UI_PASSWORD` — the single-user dashboard login.
- `SESSION_SECRET` — signs the session cookie; generate a long random value.
- `APPRISE_URL` / `APPRISE_KEY` — reaching your notification gateway.

**Option B — `CREDENTIALS_PROVIDER=vaultwarden`** (booking-provider credentials only; the app
secrets above are still supplied directly as env vars):

- Create a folder in your Vaultwarden/Bitwarden vault to hold Bookr's booking-provider
  logins (any name works; the app doesn't assume one — point `VW_FOLDER` at it). Store one
  item per booking provider, following whatever naming convention you set in
  `VW_ITEM_PREFIX`.
- Provide `VW_SERVER` (your vault's URL), `VW_FOLDER`, `VW_ITEM_PREFIX`, and a Bitwarden API
  key + master password for headless unlock: `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD`.
- The app secrets (`INGEST_TOKEN`, `UI_PASSWORD`, `SESSION_SECRET`, `APPRISE_URL`,
  `APPRISE_KEY`) are still plain environment variables in this mode — only the booking-provider
  credentials come from the vault.

In both cases, also set `PUBLIC_BASE_URL` (used in notification deep links) and
`POLL_INTERVAL_SECONDS` (scan cadence) to suit your deployment.

# +1 Double Jump Escape — game server

Colyseus 0.18 server for the game in `../1-double-jump-escape-client`.

- **Lobbies of 8.** Each lobby is a `jump_escape` room with `maxClients = 8`.
  Colyseus locks a full room, so the 9th player's `joinOrCreate` opens a new
  lobby automatically.
- **Server-authoritative economy.** Clients only send their position (and
  jumps). The server decides Jump ticks, levels, Wins, purchases, rebirths,
  goals, gifts and codes, checking positions against the shared map
  (`src/shared/layout.js`). Stage pads only pay for a *run* that started in the
  lobby (or a checkpoint) and got there no faster than the player's build can
  run, so teleporting onto a pad pays nothing.
- **No text for players.** Every reply is a code (`{ action, ok, code, ... }`);
  the client decides what, if anything, to show.
- **Limited items.** The Abyssal Hydra Boots have a global stock (500) shared by
  every server, kept in MongoDB (`limited` collection) or `data/limited.json`.
- **Persistence.** With `MONGODB_URI` (Bloxity Legion provides one) profiles
  live in MongoDB: a profile is loaded when its player joins and changes are
  written back every few seconds, so any server can pick a player up. Without
  it (local development) they go to `data/players.json` (`DATA_DIR` moves it).
  Profiles whose uid starts with `test:` (smoke-test bots, `?uid=` dev logins)
  are never saved.
- **Graceful restarts.** On SIGTERM (a deploy or scale-down) the server stops
  taking players and moves everyone to a fresh server: players in the lobby
  right away, players on the course once they're back in the lobby (at most
  90 s, then everyone). Progress is saved first and the client rejoins through
  the matchmaker. Ctrl+C (SIGINT) just saves and stops.

## Run it

```bash
npm install
npm run dev     # restarts on file changes
# or
npm start
```

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `2567` | WebSocket + HTTP port |
| `MONGODB_URI` | – | MongoDB for profiles and the limited stock (else JSON files) |
| `DATA_DIR` | `./data` | profiles without MongoDB |
| `CLIENT_ORIGIN` | – | the game site's origin (CORS for `/api`; set by Legion) |
| `CLIENT_ORIGINS` | – | extra CORS origins for `/api`, comma-separated |

HTTP endpoints:

| Endpoint | |
| --- | --- |
| `GET /health` | liveness / readiness probe (Legion) |
| `GET /api/health` | liveness |
| `GET /api/lobbies` | live lobbies and their player counts |
| `GET /api/leaderboards` | top 10 per stat |
| `POST /api/legion-auth` | Bloxity auth stub (token not verified yet — see TODO) |

## Hosting (Bloxity Legion)

The `Dockerfile` builds the server image (Node 22, runs as the `node` user,
listens on `$PORT`). `.github/workflows/deploy.yml` builds it on every push,
pushes it to this repo's GitHub Container Registry and asks Legion to roll it
out: `main` → prod, `dev` → dev, with `seatCap` 8 (one full lobby per server;
the matchmaker starts another server when one is full).

One-time setup:

1. Add the repository secret `LEGION_DEPLOY_TOKEN` (My Games → eye icon).
   Never commit the token.
2. After the first push, make the GHCR package public (repo → Packages →
   Package settings → Change visibility) so Legion can pull it.
3. Check `GAME_ID` in the workflow matches your Bloxity game id.

## Shared code

`src/shared/` is a copy of the client's `src/shared/`. The client is the
source of truth. After changing it, run:

```bash
npm run sync-shared
```

## Smoke test

With the server running:

```bash
npm run test:lobbies          # ws://localhost:2567
node scripts/lobby-test.js ws://host:port
```

It connects 17 bots and checks:

- the 8 / 8 / 1 lobby split
- Jump ticks, level ups and trampolines
- that a teleport onto a stage pad pays nothing, and a real run does
- the 2x Wins pad needs its pass
- codes, boots, trampolines and equipping
- rebirth needs MAX level; the checkpoint door
- goals advance

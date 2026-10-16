# +1 Double Jump Escape — game server

Colyseus 0.18 server for the game in `../1-double-jump-escape-client`.

- **Lobbies of 8.** Each lobby is a `jump_escape` room with `maxClients = 8`
  (`MAX_CLIENTS` overrides it; on Boxity hosting it must equal the deploy's
  `seatCap`). Colyseus locks a full room, so the 9th player's `joinOrCreate`
  opens a new lobby automatically.
- **Server-authoritative economy.** Clients only send their position and
  jumps. The server decides XP — steps for ground actually run (never faster
  than the player's boots allow), jumps (no more than the player's jumps per
  air-time, and a few a second) and jump pads (by position, at their rate) —
  levels, Wins, purchases (boots, jump pads, perks, eggs, trails), rebirths,
  gifts and offline earnings, checking positions against the shared map
  (`src/shared/layout.js`). Stage pads only pay for a *run* that started in a
  lobby (or a checkpoint) and got there no faster than the player's boots can
  run, so teleporting onto a pad pays nothing.
- **No text for players.** Every reply is a code (`{ action, ok, code, ... }`);
  the client decides what, if anything, to show. Messages of types the server
  doesn't know (an old client's) are ignored instead of closing the connection.
- **Boxity identity.** A signed-in player sends their Boxity token; the server
  asks Boxity whose it is (`POST /v1/auth/game-token/verify`) and never takes
  an account id from the client. A token Boxity won't vouch for is refused
  (the client retries, then plays as a guest). Guests play under the random id
  their browser keeps. The first time an account plays here it takes over a
  guest save — first a Boxity guest account this browser played as
  (`carriedFrom`), then this browser's own guest — and each guest save can only
  ever go to one account.
- **What other players see.** The room state carries everyone's transform,
  look, Boxity username / id (friend notices and chat bubbles), the emote
  they're playing and whether they've just fallen; level-ups, rebirths and
  stages go out as feed events with who did it.
- **Boxity profile stats.** On Boxity hosting (`BLOXITY_REPORT_TOKEN` and
  `BLOXITY_GAME_ID` set) every signed-in player's Rebirths, Best Stage, Stage
  Stars, Wins, Boots Owned and Levels Gained go to their Boxity profile every
  60 s and once more on shutdown, read from the server's own state only
  (`src/game/stats.js`). Without those variables it does nothing.
- **Gems.** Everything is bought with Wins, so there are no Gems products: the
  webhook answers 404 and Boxity refunds anything it receives.
- **Limited items.** The Abyssal Hydra Boots have a global stock (500) shared by
  every server, kept in MongoDB (`limited` collection) or `data/limited.json`.
- **Persistence.** With `MONGODB_URI` (Bloxity Legion provides one) profiles
  live in MongoDB: a profile is loaded when its player joins and changes are
  written back every few seconds, so any server can pick a player up. Without
  it (local development) they go to `data/players.json` (`DATA_DIR` moves it).
  Profiles whose uid starts with `test:` (smoke-test bots, `?uid=` dev logins)
  are never saved. Old saves are brought up to date when their player joins
  (`migrateProfile` in `src/shared/progression.js`).
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
npm start       # no restarts: start it again after changing the code
```

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `2567` | WebSocket + HTTP port |
| `MONGODB_URI` | – | MongoDB for profiles and the limited stock (else JSON files) |
| `DATA_DIR` | `./data` | profiles without MongoDB |
| `CLIENT_ORIGIN` | – | the game site's origin (CORS for `/api`; set by Legion) |
| `CLIENT_ORIGINS` | – | extra CORS origins for `/api`, comma-separated |
| `MAX_CLIENTS` | `8` | players per lobby (= the deploy's `seatCap`) |
| `BLOXITY_GAME_ID` | – | set by Legion; with the token below, turns on profile stats |
| `BLOXITY_REPORT_TOKEN` | – | set by Legion; authenticates profile stats |
| `BLOXITY_GAME_SLUG` | `BLOXITY_GAME_ID`, else `1-double-jump-escape` | the slug tokens are verified for |
| `BLOXITY_API_URL` | `https://api.bloxity.io` | |
| `LEGION_WEBHOOK_SECRET` | – | checked against `x-legion-webhook-secret` when set |

HTTP endpoints:

| Endpoint | |
| --- | --- |
| `GET /health` | liveness / readiness probe (Legion) |
| `GET /api/health` | liveness |
| `GET /api/lobbies` | live lobbies and their player counts |
| `GET /api/leaderboards` | top 10 per stat |
| `POST /api/legion-auth` | `{ token }` → the Boxity user Boxity says it belongs to (401 if none) |
| `POST /api/legion-webhook` | Gems fulfilment: refunds (no Gems products) |

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

Boxity's "Open Rooms" list on the game page fills from a room reporter that
ships with Boxity's server template (`legion-room-reporter`); it isn't in this
repo or Boxity's public docs, so ask Boxity for it if you want the list.
Friend invites and the Join links they send work without it.

## Shared code

`src/shared/` is a copy of the client's `src/shared/`. The client is the
source of truth. After changing it, run:

```bash
npm run sync-shared
```

## Tests

`npm run test:economy` checks the rules without a server: jumps per level and
per rebirth, speed per boots, every pair of boots opening two stages, the
first boots costing Stage 1's Wins, jump pads (free, for Wins, by rebirth),
trails opening by stage, what a rebirth resets and keeps, save migration (with
refunds and the pads older rebirths had opened), Boxity ids, and a guest save
going to a new account only once.

With the server running:

```bash
npm run test:lobbies             # ws://localhost:2567
node scripts/lobby-test.js ws://host:port
```

It connects 17 bots and checks the 8 / 8 / 1 lobby split; that jumps and
walking pay XP (but not one jump more than the level allows, jump spam,
standing still, or running faster than the boots); the free jump pad pays
and one not bought yet doesn't; level-ups; that a teleport onto a stage pad
pays nothing and a real run does; boot doors; the 2x Wins pad's pass;
respawning; buying (boots in order, pads and perks need Wins, locked eggs);
that an old client's unknown message doesn't disconnect it; rebirth needing
MAX; world doors and the checkpoint door; emotes and falls showing for other
players; that a `bx:` uid without a token is not that account and a bad token
is refused; and that a guest's save survives a reconnect.

```bash
npm run test:loop                # ws://localhost:2567, about ten minutes
```

plays the whole loop for real: a new player trains on the jump pad, runs each
stage they have the jumps and boots for, buys boots and a jump pad, reaches
level 15 and rebirths, then checks the rebirth (+1 jump, x2 XP, Wins, boots
and stages kept), that the teleport never goes past the best stage reached,
and that World 2 opens.

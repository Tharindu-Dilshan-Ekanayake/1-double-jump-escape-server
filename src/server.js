import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import cors from 'cors'
import express from 'express'

import { EscapeRoom, drainLobbies, lobbyCount } from './rooms/EscapeRoom.js'
import { ROOM_NAME } from './shared/gameData.js'
import { closeProfiles, initProfiles, leaderboards } from './store/profiles.js'

const PORT = Number(process.env.PORT) || 2567

// Vite's dev server origin, the game site Bloxity Legion passes in CLIENT_ORIGIN,
// and any extra CLIENT_ORIGINS (comma-separated). Colyseus's own matchmaking
// routes set their CORS headers themselves, so this only guards the /api routes.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...[process.env.CLIENT_ORIGIN, ...(process.env.CLIENT_ORIGINS || '').split(',')]
    .map((origin) => (origin || '').trim())
    .filter(Boolean),
]

/** How long a draining server waits for players on the course to get back to the lobby. */
const DRAIN_SOFT_MS = 90_000
/** Hard limit (Legion waits up to 10 minutes after SIGTERM). */
const DRAIN_MAX_MS = 5 * 60_000

const server = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  // SIGTERM drains (below) instead of dropping everyone at once.
  gracefullyShutdown: false,
  express: (app) => {
    // Liveness/readiness probe for Bloxity Legion: answer straight away.
    app.get('/health', (_req, res) => {
      res.status(200).send('ok')
    })

    app.use('/api', cors({ origin: ALLOWED_ORIGINS, credentials: true }))
    app.use('/api', express.json())

    app.get('/api/health', (_req, res) => {
      res.json({ ok: true })
    })

    app.get('/api/leaderboards', (_req, res) => {
      res.json(leaderboards())
    })

    /** Live lobbies — handy for checking the 8-per-lobby split. */
    app.get('/api/lobbies', async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME })
      res.json(
        rooms.map((room) => ({
          roomId: room.roomId,
          players: room.clients,
          maxPlayers: room.maxClients,
          locked: room.locked,
        })),
      )
    })

    /**
     * Auth passthrough for the Bloxity SDK.
     *
     * The frontend can POST `{ token, user }` here from
     * `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`.
     *
     * NOTE: not wired up on the frontend yet — the game identifies players by the
     * uid it sends when joining a lobby (the Bloxity account id, or a per-browser
     * guest id). When you wire this, verify the token and pass the returned
     * accessToken in the room join options instead of the raw uid.
     */
    app.post('/api/legion-auth', (req, res) => {
      // TODO: verify the Bloxity JWT here before trusting req.body.user.
      // Until that happens `req.body.user` is attacker-controlled — anyone can POST any
      // legionId they like. Verify `req.body.token` against Bloxity's public key /
      // introspection endpoint and derive the user from the *verified* claims.
      res.json({
        accessToken: 'stub',
        user: { legionId: req.body?.user?._id },
      })
    })

    /**
     * Webhook for future Bux purchases. Everything in the game is bought with
     * Wins today; this only acknowledges so the platform doesn't retry.
     */
    app.post('/api/legion-webhook', (_req, res) => {
      // TODO: verify x-legion-webhook-secret, dedupe by transactionId, grant the item.
      res.sendStatus(200)
    })
  },
})

server.define(ROOM_NAME, EscapeRoom)

// Rooms persist their players in onLeave during shutdown; save those last.
server.onShutdown(() => closeProfiles())

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let stopping = false

/**
 * SIGTERM (a deploy or scale-down): stop taking players, move everyone to a fresh
 * server (players on the course once they're back in the lobby), then shut down.
 */
async function drainAndExit(signal) {
  if (stopping) return
  stopping = true
  const started = Date.now()
  console.log(`[server] ${signal}: draining ${lobbyCount()} lobbies`)
  while (Date.now() - started < DRAIN_MAX_MS) {
    const left = drainLobbies(Date.now() - started > DRAIN_SOFT_MS)
    if (left === 0) break
    await sleep(1000)
  }
  // Give the last clients a moment to receive their close frames.
  await sleep(500)
  await server.gracefullyShutdown(true)
}

/** Ctrl+C in a terminal: no draining, just save and stop. */
async function stopNow(signal) {
  if (stopping) return
  stopping = true
  console.log(`[server] ${signal}: shutting down`)
  await server.gracefullyShutdown(true)
}

process.on('SIGTERM', () => drainAndExit('SIGTERM'))
process.on('SIGINT', () => stopNow('SIGINT'))

await initProfiles()
await server.listen(PORT)
console.log(`Double Jump Escape server listening on ws://localhost:${PORT} (HTTP API at http://localhost:${PORT}/api)`)

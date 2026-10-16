import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import cors from 'cors'
import express from 'express'

import { verifyBloxityToken } from './game/identity.js'
import { installStatReporter } from './game/stats.js'
import { EscapeRoom, drainLobbies, lobbyCount, onlinePlayers } from './rooms/EscapeRoom.js'
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
     * `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`: who a Boxity
     * token belongs to, as Boxity itself says (never the `user` the client sent).
     * The game doesn't need it (lobbies verify the token on join); it's here for
     * tools and checks.
     */
    app.post('/api/legion-auth', async (req, res) => {
      const verified = await verifyBloxityToken(req.body?.token)
      if (!verified) return res.status(401).json({ error: 'invalid token' })
      const { user } = verified
      return res.json({ user: { legionId: user._id ?? user.id, username: user.username, displayName: user.displayName } })
    })

    /**
     * Gems purchase fulfilment (Boxity -> this server). Everything in the game is
     * bought with Wins, so there is no Gems product to grant: answering non-2xx
     * makes Boxity refund the Gems instead of taking them for nothing.
     */
    app.post('/api/legion-webhook', (req, res) => {
      const secret = process.env.LEGION_WEBHOOK_SECRET
      if (secret && req.get('x-legion-webhook-secret') !== secret) return res.status(401).json({ error: 'bad secret' })
      console.warn(`[webhook] no Gems product "${String(req.body?.sku ?? '').slice(0, 60)}" in this game; refunding`)
      return res.status(404).json({ error: 'unknown sku' })
    })
  },
})

server.define(ROOM_NAME, EscapeRoom)

/** Sends everyone's stats one last time; null until the reporter starts (or when it's off). */
let flushStats = null

// Rooms persist their players in onLeave during shutdown; save those last.
server.onShutdown(async () => {
  await flushStats?.()
  await closeProfiles()
})

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
// Boxity profile stats (only on Boxity hosting: BLOXITY_REPORT_TOKEN + BLOXITY_GAME_ID).
flushStats = installStatReporter(onlinePlayers)
console.log(`Double Jump Escape server listening on ws://localhost:${PORT} (HTTP API at http://localhost:${PORT}/api)`)

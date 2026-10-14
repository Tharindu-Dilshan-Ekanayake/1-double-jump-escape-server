import { Room, ServerError } from '@colyseus/core'

import {
  BOOT_BY_ID,
  GAIN_TICK_MS,
  MAX_PLAYERS_PER_LOBBY,
  STAGE_COUNT,
  gainBreakdown,
  padWins,
  parseList,
  playerMoveStats,
  raiseStars,
  reviveCost,
  starsOf,
} from '../shared/gameData.js'
import { checkpointFor, getLayout, inLobby, insideBox, onPlateau, stageAt, stagePar, trampolineAt } from '../shared/layout.js'
import {
  addJump,
  bumpCounter,
  buy,
  checkGoal,
  claimChest,
  claimDaily,
  claimGift,
  equip,
  readJSON,
  rebirth,
  redeemCode,
} from '../game/economy.js'
import { PERSISTED_FIELDS, leaderboards, limitedLeft, loadProfile, releaseLimited, reserveLimited, saveProfile } from '../store/profiles.js'
import { EscapeState, PlayerState } from './schema.js'

const layout = getLayout()
const SPAWN = layout.spawn
const HYDRA = BOOT_BY_ID.hydra
const LIMITED = { left: limitedLeft, reserve: reserveLimited, release: releaseLimited }

/** Movement (studs) needed inside one gain window to count as playing. */
const MIN_MOVE_PER_TICK = 1
/** Jumps paid per gain window (more than a person can really press). */
const JUMPS_PAID_PER_TICK = 6
/** Grounded course positions remembered per player (where a revive may put you). */
const GROUND_TRAIL = 240

/** uid -> { room, client }: one live session per profile. */
const activeByUid = new Map()
/** Every lobby running in this process. */
const liveRooms = new Set()
/** Lobby numbers in use (server logs only; players never see them). */
const usedLobbyNumbers = new Set()
/** Set when this server is shutting down: new players go to another server. */
let draining = false

/** Close code that tells the client to reconnect straight away (to a fresh server). */
export const MOVE_SERVER_CODE = 4002
/** Close code for a profile that opened in another window. */
export const TAKEN_OVER_CODE = 4001

/**
 * Drains this server before it shuts down (Bloxity Legion sends SIGTERM on a
 * deploy or scale-down): no new joins, and every player is moved to a fresh
 * server, those on the course once they're back in the lobby (or `force`).
 * Progress is saved first; the client reconnects through the matchmaker.
 * Returns how many players are still here.
 */
export function drainLobbies(force = false) {
  draining = true
  let remaining = 0
  for (const room of liveRooms) {
    room.lock()
    for (const client of [...room.clients]) {
      const player = room.state.players.get(client.sessionId)
      if (!force && player && !inLobby(player.z)) {
        remaining += 1
        continue
      }
      room.persist(client.sessionId)
      client.leave(MOVE_SERVER_CODE)
    }
  }
  return remaining
}

export const lobbyCount = () => liveRooms.size

function claimLobbyNumber() {
  let n = 1
  while (usedLobbyNumbers.has(n)) n += 1
  usedLobbyNumbers.add(n)
  return n
}

const clean = (text, max) =>
  String(text ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max)

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)
/** A run: where and when it started, when it entered each stage, and whether it used a revive. */
const newRun = (z, at) => ({ z, at, revived: false, entered: {} })
const fail = (code) => ({ ok: false, code })

/**
 * One lobby of up to eight players.
 *
 * Colyseus locks the room once `maxClients` is reached, so `joinOrCreate` from the
 * ninth player automatically spins up a fresh lobby — no custom matchmaking needed.
 *
 * Movement is client-driven (the client sends its transform ~20x/sec); everything
 * that is worth anything — Jump ticks, levels, wins, purchases — is decided here
 * and synced back through the room state. A "run" starts when a player leaves
 * the lobby (or is sent to a checkpoint / revived by the server); stage pads and
 * stage progress only count for a run that got there at a believable speed.
 */
export class EscapeRoom extends Room {
  maxClients = MAX_PLAYERS_PER_LOBBY
  patchRate = 50
  state = new EscapeState()

  onAuth() {
    if (draining) throw new ServerError(503, 'restarting')
    return true
  }

  onCreate() {
    liveRooms.add(this)
    this.lobbyNumber = claimLobbyNumber()
    /** sessionId -> per-connection bookkeeping that never needs syncing. */
    this.sessions = new Map()
    this.state.hydraLeft = limitedLeft(HYDRA.id, HYDRA.limited)

    // The client asks for this once its handlers are registered; anything sent
    // from onJoin itself can arrive before then and be dropped.
    this.handle('hello', (client, player, session) => {
      client.send('welcome', { isNew: session.isNew })
      client.send('leaderboards', leaderboards())
      if (session.daily) client.send('daily', session.daily)
    })
    this.handle('move', this.onMove)
    this.handle('jump', this.onJump)
    this.handle('pad', this.onPad)
    this.handle('revive', this.onRevive)
    this.handle('checkpoint', this.onCheckpoint)
    this.handle('avatar', (_client, player, _session, message) => {
      if (typeof message.avatar === 'string' && message.avatar.length < 4000) player.avatar = message.avatar
    })
    this.handle('buy', async (client, player, session, message) => {
      const result = await buy(player, message, LIMITED)
      if (result.ok && message.cat === 'boot' && BOOT_BY_ID[message.id]?.limited) {
        this.state.hydraLeft = limitedLeft(HYDRA.id, HYDRA.limited)
      }
      this.reply(client, 'buy', result)
    })
    this.handle('equip', (client, player, _session, message) => {
      this.reply(client, 'equip', equip(player, message))
    })
    this.handle('rebirth', (client, player) => {
      this.reply(client, 'rebirth', rebirth(player))
    })
    this.handle('claim', (client, player, session, message) => {
      if (message.what === 'chest') this.reply(client, 'claim', claimChest(player, session))
      else if (message.what === 'gift') this.reply(client, 'claim', claimGift(player, session, Number(message.index)))
    })
    this.handle('code', (client, player, session, message) => {
      this.reply(client, 'code', redeemCode(player, session, message.code))
    })

    this.setSimulationInterval(() => this.tick(), 100)
    this.clock.setInterval(() => this.persistAll(), 10_000)
    this.clock.setInterval(() => this.broadcast('leaderboards', leaderboards()), 15_000)
    this.clock.setInterval(() => {
      this.state.hydraLeft = limitedLeft(HYDRA.id, HYDRA.limited)
    }, 5000)
  }

  /** Registers a message handler that only runs for a fully joined player. */
  handle(type, handler) {
    this.onMessage(type, (client, message) => {
      const player = this.state.players.get(client.sessionId)
      const session = this.sessions.get(client.sessionId)
      if (!player || !session) return
      handler.call(this, client, player, session, message && typeof message === 'object' ? message : {})
    })
  }

  /** Result codes only: the client decides what (if anything) to show. */
  reply(client, action, result) {
    const { levelUp, ...rest } = result
    client.send('result', { action, ...rest })
    if (levelUp) client.send('levelup', levelUp)
  }

  async onJoin(client, options = {}) {
    const uid = clean(options.uid, 80) || `anon:${client.sessionId}`

    // The same profile signing in again (second tab, reconnect from another
    // device): save the old session and close it so progress can't fork.
    const previous = activeByUid.get(uid)
    if (previous && previous.client !== client) {
      previous.room.persist(previous.client.sessionId)
      previous.client.leave(TAKEN_OVER_CODE)
    }

    const profile = await loadProfile(uid)
    const player = new PlayerState()
    if (profile) {
      for (const field of PERSISTED_FIELDS) {
        if (profile[field] !== undefined && typeof profile[field] === typeof player[field]) {
          player[field] = profile[field]
        }
      }
    }
    player.name = clean(options.name, 20) || profile?.name || 'Player'
    if (typeof options.avatar === 'string' && options.avatar.length < 4000) player.avatar = options.avatar
    player.x = SPAWN.x + (Math.random() - 0.5) * 6
    player.y = SPAWN.y
    player.z = SPAWN.z + (Math.random() - 0.5) * 3
    player.r = SPAWN.yaw
    const now = Date.now()
    player.sessionAt = now
    player.gifts = ''

    const session = {
      uid,
      client,
      counters: readJSON(player.counters, {}),
      codes: Array.isArray(profile?.codes) ? [...profile.codes] : [],
      moved: 0,
      jumped: 0,
      lastGainAt: now,
      lastPadAt: 0,
      lastCheckpointAt: 0,
      lastMoveAt: now,
      jumpWindow: { start: 0, count: 0 },
      /** Where and when the current run started; null after a suspicious jump. */
      run: newRun(player.z, now),
      /** A server-approved teleport the next move may land on. */
      expect: null,
      groundTrail: [],
      isNew: !profile,
      daily: null,
    }
    session.daily = claimDaily(player, session, now)

    this.state.players.set(client.sessionId, player)
    this.sessions.set(client.sessionId, session)
    activeByUid.set(uid, { room: this, client })
    console.log(`[lobby ${this.lobbyNumber}] ${player.name} joined (${this.state.players.size}/${this.maxClients})`)
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    const session = this.sessions.get(client.sessionId)
    this.persist(client.sessionId)
    if (session && activeByUid.get(session.uid)?.client === client) activeByUid.delete(session.uid)
    this.state.players.delete(client.sessionId)
    this.sessions.delete(client.sessionId)
    if (player) console.log(`[lobby ${this.lobbyNumber}] ${player.name} left (${this.state.players.size}/${this.maxClients})`)
  }

  onDispose() {
    liveRooms.delete(this)
    this.persistAll()
    usedLobbyNumbers.delete(this.lobbyNumber)
  }

  persist(sessionId) {
    const player = this.state.players.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (!player || !session) return
    // A newer window owns this profile now; don't overwrite its progress.
    const owner = activeByUid.get(session.uid)
    if (owner && owner.client !== session.client) return
    saveProfile(session.uid, player, { codes: session.codes })
  }

  persistAll() {
    for (const sessionId of this.sessions.keys()) this.persist(sessionId)
  }

  /* -------------------------------------------------------------------------
   * Simulation: Jump ticks, stage progress, goals
   * ----------------------------------------------------------------------- */

  tick() {
    const now = Date.now()
    const others = Math.max(0, this.state.players.size - 1)

    this.state.players.forEach((player, sessionId) => {
      const session = this.sessions.get(sessionId)
      if (!session) return

      if (now - session.lastGainAt >= GAIN_TICK_MS) {
        session.lastGainAt = now
        const jumps = Math.min(session.jumped, JUMPS_PAID_PER_TICK)
        const active = session.moved >= MIN_MOVE_PER_TICK || jumps > 0
        session.moved = 0
        session.jumped = 0
        // Bouncing on a trampoline you own counts even when you don't touch the keys.
        const tramp = trampolineAt(layout, player.x, player.y, player.z)
        const onTramp = tramp && (tramp.mult === 1 || parseList(player.tramps).includes(tramp.id))
        if (active || onTramp) {
          // Boots pay every second you play (times the trampoline you bounce
          // on), and every jump pays the same again: "+1 Double Jump".
          const rate = gainBreakdown(player, { others, now }).total
          const mult = onTramp ? tramp.mult : 1
          const gain = Math.max(1, Math.round(rate * mult + rate * jumps))
          const levelUp = addJump(player, gain)
          session.client.send('gain', { n: gain, t: mult })
          if (levelUp) session.client.send('levelup', levelUp)
        }
      }

      // Stage progress: standing on a plateau reached by a believable run.
      const stage = stageAt(layout, player.z)
      if (stage && stage.index > player.bestStage && onPlateau(stage, player.y, player.z) && this.runReached(session, stage)) {
        player.bestStage = stage.index
      }

      const goal = checkGoal(player, session)
      if (goal) {
        session.client.send('goal', { index: goal.index, reward: goal.reward })
        if (goal.levelUp) session.client.send('levelup', goal.levelUp)
      }
    })
  }

  /** Did the current run start before this stage's gate, and get here no faster than possible? */
  runReached(session, stage, targetZ = stage.plateauZ0) {
    const run = session.run
    if (!run || run.z <= stage.gateZ + 0.5) return false
    const player = this.state.players.get(session.client.sessionId)
    const speed = Math.max(16, playerMoveStats(player).speed)
    const minSeconds = (run.z - targetZ) / (speed * 1.5) - 1.5
    return (Date.now() - run.at) / 1000 >= minSeconds
  }

  /* -------------------------------------------------------------------------
   * Messages
   * ----------------------------------------------------------------------- */

  onMove(_client, player, session, m) {
    const now = Date.now()
    const x = num(m.x, player.x)
    const y = num(m.y, player.y)
    const z = num(m.z, player.z)
    const dist = Math.hypot(x - player.x, z - player.z)
    const dt = Math.max(0.05, (now - session.lastMoveAt) / 1000)
    session.lastMoveAt = now

    // Faster than this build could ever run: a teleport. Only server-approved
    // ones (checkpoint, revive) and trips home keep the run going.
    const allowed = playerMoveStats(player).speed * dt * 1.6 + 12
    if (dist > allowed) {
      const expect = session.expect
      if (expect && now < expect.until && Math.hypot(x - expect.x, z - expect.z) < 6) {
        // A checkpoint starts a new run there; a revive carries the old one on.
        if (!expect.keepRun) session.run = newRun(z, now)
        session.expect = null
      } else if (!inLobby(z)) {
        session.run = null
      }
    } else {
      session.moved += dist
    }

    player.x = x
    player.y = y
    player.z = z
    player.r = num(m.r, player.r)
    player.s = Math.min(Math.max(num(m.s), 0), 400)
    player.air = Boolean(m.a)
    if (Number.isInteger(m.f)) player.flips = m.f & 0xffff

    // In the lobby the run (re)starts; leaving it starts the clock.
    if (inLobby(z)) session.run = newRun(z, now)
    else if (session.run) {
      // When the run first entered each stage (for the par-time star).
      const stage = stageAt(layout, z)
      if (stage && !session.run.entered[stage.index]) session.run.entered[stage.index] = now
    }

    // Remember where the player stood on the course (a revive can put them back
    // there): a point every 1.5 studs, or every second when standing still.
    const last = session.groundTrail[session.groundTrail.length - 1]
    if (!player.air && !inLobby(z) && (!last || now - last.at > 1000 || Math.hypot(x - last.x, z - last.z) > 1.5)) {
      session.groundTrail.push({ x, y, z, at: now })
      if (session.groundTrail.length > GROUND_TRAIL) session.groundTrail.shift()
    }
  }

  onJump(_client, player, session) {
    // Counted for the jump goals; capped so a macro can't farm them.
    const now = Date.now()
    const w = session.jumpWindow
    if (now - w.start > 1000) {
      w.start = now
      w.count = 0
    }
    w.count += 1
    if (w.count > 12) return
    session.jumped += 1
    bumpCounter(player, session, 'jumps', 1)
  }

  onPad(client, player, session, { stage: index, kind }) {
    const now = Date.now()
    if (now - session.lastPadAt < 1500) return
    const pad = layout.pads.find((p) => p.stage === index && p.kind === kind)
    const stage = layout.stages[index - 1]
    if (!pad || !stage || !insideBox(pad, player.x, player.y, player.z, 3)) {
      this.reply(client, 'pad', fail('tooFar'))
      return
    }
    if (player.rebirths < stage.rebirths) {
      this.reply(client, 'pad', fail('locked'))
      return
    }
    if (kind === 'double' && !player.pass2xWins) {
      this.reply(client, 'pad', { ok: false, code: 'needPass', product: 'pass2xWins' })
      return
    }
    if (!this.runReached(session, stage, (pad.min[2] + pad.max[2]) / 2)) {
      this.reply(client, 'pad', fail('invalid'))
      return
    }
    session.lastPadAt = now
    // Stars: 1 for the clear, +1 without a revive, +1 more under par time.
    const run = session.run
    const seconds = (now - (run.entered[index] ?? run.at)) / 1000
    const par = stagePar(stage)
    const earned = run.revived ? 1 : seconds <= par ? 3 : 2
    const before = starsOf(player)[index - 1]
    if (earned > before) player.stars = raiseStars(player.stars, index, earned)
    // One pad per run: the next run starts back in the lobby.
    session.run = null
    const wins = padWins(stage.wins, player, kind === 'double')
    player.wins += wins
    bumpCounter(player, session, 'wins', wins)
    bumpCounter(player, session, 'runs', 1)
    if (index > player.bestStage) player.bestStage = index
    client.send('reward', { wins, stage: index, kind, stars: earned, before, seconds: Math.round(seconds * 10) / 10, par })
  }

  /** Pay Wins to carry on from the last safe spot instead of starting over. */
  onRevive(client, player, session, { stage: index, x, y, z }) {
    const stage = layout.stages[index - 1]
    if (!stage || ![x, y, z].every(Number.isFinite)) {
      this.reply(client, 'revive', fail('invalid'))
      return
    }
    const now = Date.now()
    const seen = session.groundTrail.some((p) => now - p.at < 180_000 && Math.hypot(p.x - x, p.z - z) < 4 && Math.abs(p.y - y) < 4)
    if (!seen || stageAt(layout, z) !== stage) {
      this.reply(client, 'revive', fail('invalid'))
      return
    }
    const cost = reviveCost(index)
    if (player.wins < cost) {
      this.reply(client, 'revive', { ok: false, code: 'poor', need: cost - player.wins })
      return
    }
    player.wins -= cost
    bumpCounter(player, session, 'revives', 1)
    if (session.run) session.run.revived = true
    // Revived on the run's own path: the run (and its clock) carries on.
    session.expect = { x, z, until: now + 6000, keepRun: true }
    this.reply(client, 'revive', { ok: true, code: 'revived', x, y, z, stage: index })
  }

  /** Teleport to a reached stage's checkpoint (from the lobby door or the Teleport menu). */
  onCheckpoint(client, player, session, { stage: wanted }) {
    const now = Date.now()
    if (now - session.lastCheckpointAt < 2000) return
    const best = Math.min(player.bestStage, STAGE_COUNT)
    const index = Number.isInteger(wanted) ? Math.min(Math.max(1, wanted), best) : best
    if (best < 1) {
      this.reply(client, 'checkpoint', fail('noStage'))
      return
    }
    const point = checkpointFor(layout, index)
    session.lastCheckpointAt = now
    session.expect = { x: point.x, z: point.z, until: now + 6000 }
    this.reply(client, 'checkpoint', { ok: true, code: 'teleport', stage: index, ...point })
  }
}

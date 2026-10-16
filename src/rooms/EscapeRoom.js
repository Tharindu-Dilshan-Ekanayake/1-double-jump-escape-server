import { Room, ServerError } from '@colyseus/core'

import {
  BOOT_BY_ID,
  CONFIG,
  MAX_PLAYERS_PER_LOBBY,
  STAGE_COUNT,
  migrateProfile,
  offlineEarnings,
  padOpen,
  playerMoveStats,
  raiseStars,
  stageNeeds,
  stageOpen,
  stageWins,
  starsOf,
  xpPerJump,
} from '../shared/gameData.js'
import { checkpointFor, checkpointOn, getLayout, inLobby, insideBox, onPlateau, padAt, platformAt, stageAt, stagePar } from '../shared/layout.js'
import { addXp, bumpCounter, buy, claimChest, claimDaily, claimGift, equip, pets, readJSON, rebirth } from '../game/economy.js'
import { accountUid, isGuestUid, verifyBloxityToken } from '../game/identity.js'
import { rememberForStats } from '../game/stats.js'
import { PERSISTED_FIELDS, claimGuestSave, leaderboards, limitedLeft, loadProfile, releaseLimited, reserveLimited, saveProfile } from '../store/profiles.js'
import { EscapeState, PlayerState } from './schema.js'

const layout = getLayout()
const SPAWN = layout.spawn
const HYDRA = BOOT_BY_ID.hydra
const LIMITED = { left: limitedLeft, reserve: reserveLimited, release: releaseLimited }

/** XP is batched and reported this often. */
const GAIN_FLUSH_MS = 500
/** Running may be this much faster than the build allows (lag, smoothing) and still pay steps. */
const STEP_SLACK = 1.3
/** A move message pays at most this many steps (a burst after a stall). */
const MAX_STEPS_PER_MOVE = 4
/** Boxity emote catalogue ids. */
const EMOTE_ID = /^[A-Za-z0-9]{24}$/
/** Seats per lobby. On Boxity hosting this must equal the seat cap the server deploys with. */
export const SEATS = Math.min(100, Math.max(2, Number(process.env.MAX_CLIENTS) || MAX_PLAYERS_PER_LOBBY))
/** Grounded course positions remembered per player (where a respawn may put you). */
const GROUND_TRAIL = 400
/** How long ago a platform may have been stood on to respawn there. */
const RESPAWN_MEMORY_MS = 180_000

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

/** Every player on this server right now: profile id and live state (for the stats reporter). */
export function* onlinePlayers() {
  for (const room of liveRooms) {
    for (const [sessionId, session] of room.sessions) {
      const state = room.state.players.get(sessionId)
      if (state) yield { uid: session.uid, state }
    }
  }
}

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
/** A run: where and when it started, when it entered each stage, and whether it fell (and respawned). */
const newRun = (z, at) => ({ z, at, fell: false, entered: {} })
const fail = (code) => ({ ok: false, code })

/**
 * One lobby of up to eight players.
 *
 * Colyseus locks the room once `maxClients` is reached, so `joinOrCreate` from the
 * ninth player automatically spins up a fresh lobby — no custom matchmaking needed.
 *
 * Movement is client-driven (the client sends its transform ~20x/sec); everything
 * that is worth anything — XP, levels, wins, purchases — is decided here and
 * synced back through the room state. XP is paid per step and per jump: steps
 * for ground actually run (never faster than the player's boots allow), the
 * jumps they make (no more than their jumps per air-time, and a few a second)
 * and the ones an unlocked jump pad gives them while they stand on it (at its
 * rate). A
 * "run" starts when a player leaves a world's lobby (or is sent to a
 * checkpoint by the server); stage pads and stage progress only count for a
 * run that got there at a believable speed, through doors it could open.
 */
export class EscapeRoom extends Room {
  maxClients = SEATS
  patchRate = 50
  state = new EscapeState()

  /**
   * Who is joining. A Boxity account only on a token Boxity vouches for (never
   * an id the client sends); anyone else plays as a guest, under the id their
   * browser keeps.
   */
  async onAuth(client, options = {}) {
    if (draining) throw new ServerError(503, 'restarting')
    if (options.token) {
      const verified = await verifyBloxityToken(options.token)
      // Not vouched for (or Boxity unreachable): the client tries again, then plays as a guest.
      if (!verified) throw new ServerError(401, 'auth')
      const { user, carriedFrom } = verified
      return {
        uid: accountUid(user._id ?? user.id),
        username: clean(user.username, 40),
        name: clean(user.displayName || user.username, 20),
        carriedFrom,
        guestUid: isGuestUid(options.guest) ? options.guest : null,
      }
    }
    const uid = clean(options.uid, 80)
    return { uid: isGuestUid(uid) ? uid : `anon:${client.sessionId}`, username: '', name: '' }
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
      if (session.offline) {
        client.send('offline', session.offline)
        session.offline = null
      }
    })
    // Anything else (an old client's message for a feature that's gone) is
    // ignored rather than closing the connection.
    this.onMessage('*', () => {})
    this.handle('move', this.onMove)
    this.handle('jump', this.onJump)
    this.handle('pad', this.onPad)
    this.handle('respawn', this.onRespawn)
    this.handle('checkpoint', this.onCheckpoint)
    this.handle('world', this.onWorld)
    this.handle('avatar', (_client, player, _session, message) => {
      if (typeof message.avatar === 'string' && message.avatar.length < 4000) player.avatar = message.avatar
    })
    // A Boxity emote (or '' to stop): everyone else plays it on this player. Only the
    // id's shape is checked; Boxity only ever sends emotes the player may use.
    this.handle('emote', (_client, player, session, message) => {
      const id = typeof message.id === 'string' && EMOTE_ID.test(message.id) ? message.id : ''
      const now = Date.now()
      if (id && now - session.lastEmoteAt < 250) return
      if (!id && !player.emote) return
      session.lastEmoteAt = now
      player.emote = id
      player.emoteSeq = (player.emoteSeq + 1) & 0xffff
    })
    this.handle('buy', async (client, player, session, message) => {
      const result = await buy(player, message, LIMITED)
      if (result.ok && message.cat === 'boot' && BOOT_BY_ID[message.id]?.limited) {
        this.state.hydraLeft = limitedLeft(HYDRA.id, HYDRA.limited)
      }
      if (result.ok && result.cat === 'egg') bumpCounter(player, session, 'eggs', 1)
      this.reply(client, 'buy', result)
    })
    this.handle('equip', (client, player, _session, message) => {
      this.reply(client, 'equip', equip(player, message))
    })
    this.handle('pet', (client, player, _session, message) => {
      this.reply(client, 'pet', pets(player, message))
    })
    this.handle('rebirth', (client, player) => {
      const result = rebirth(player)
      if (result.ok) this.feed(client, { kind: 'rebirth', name: player.name, value: player.rebirths })
      this.reply(client, 'rebirth', result)
    })
    this.handle('claim', (client, player, session, message) => {
      if (message.what === 'chest') this.reply(client, 'claim', claimChest(player, session))
      else if (message.what === 'gift') this.reply(client, 'claim', claimGift(player, session, Number(message.index)))
    })

    this.setSimulationInterval((delta) => this.tick(delta), 100)
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
    if (levelUp) this.levelUp(client, this.state.players.get(client.sessionId), levelUp)
  }

  /** Tells everyone else in the lobby (the client turns it into a little popup, and a burst over that player). */
  feed(client, event) {
    this.broadcast('feed', { ...event, sid: client.sessionId }, { except: client })
  }

  /** A level-up: the player sees it; others hear about new jumps, MAX and new titles. */
  levelUp(client, player, levelUp) {
    if (!player) return
    client.send('levelup', levelUp)
    if (levelUp.title !== null) this.feed(client, { kind: 'title', name: player.name, value: levelUp.title })
    else if (levelUp.jumpsTo > levelUp.jumpsFrom || levelUp.to >= levelUp.max) {
      this.feed(client, { kind: 'level', name: player.name, value: levelUp.to, jumps: levelUp.jumpsTo, max: levelUp.to >= levelUp.max })
    }
  }

  async onJoin(client, options = {}) {
    const auth = client.auth ?? {}
    const uid = auth.uid || `anon:${client.sessionId}`

    // The same profile signing in again (second tab, reconnect from another
    // device): save the old session and close it so progress can't fork.
    const previous = activeByUid.get(uid)
    if (previous && previous.client !== client) {
      previous.room.persist(previous.client.sessionId)
      previous.client.leave(TAKEN_OVER_CODE)
    }

    let stored = await loadProfile(uid)
    // An account that has never played here takes over a guest save, once.
    if (!stored && uid.startsWith('bx:')) stored = await this.takeGuestSave(uid, auth)
    // Older saves are brought up to date (and every number clamped) first.
    const profile = migrateProfile(stored)
    const player = new PlayerState()
    if (profile) {
      for (const field of PERSISTED_FIELDS) {
        if (profile[field] !== undefined && typeof profile[field] === typeof player[field]) {
          player[field] = profile[field]
        }
      }
    }
    player.name = auth.name || clean(options.name, 20) || profile?.name || 'Player'
    player.username = auth.username || ''
    player.boxityId = uid.startsWith('bx:') ? uid.slice(3) : ''
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
      lastPadAt: 0,
      lastCheckpointAt: 0,
      lastMoveAt: now,
      jumpWindow: { start: 0, count: 0 },
      /** Jumps since the player last stood on the ground (a jump past their max pays nothing). */
      airJumps: 0,
      /** Where and when the current run started; null after a suspicious jump. */
      run: newRun(player.z, now),
      /** A server-approved teleport the next move may land on. */
      expect: null,
      groundTrail: [],
      isNew: !profile,
      daily: null,
      offline: null,
      /** Studs run towards the next step. */
      stepDist: 0,
      lastEmoteAt: 0,
      /** Jumps owed by the jump pad you're on, and how long you've been on one. */
      padAcc: 0,
      padSeconds: 0,
      /** XP not yet reported to the client. */
      pending: { gain: 0, jumps: 0, lucky: 0, pad: 0 },
      lastFlushAt: now,
    }
    session.daily = claimDaily(player, session, now)

    // Away from the game: 30% of your best jump pad's rate, for up to 8 hours.
    if (stored?.lastSeen) {
      const away = offlineEarnings(player, (now - stored.lastSeen) / 1000)
      if (away) {
        const levelUp = addXp(player, away.xp)
        session.offline = { ...away, levels: levelUp ? levelUp.to - levelUp.from : 0 }
      }
    }

    this.state.players.set(client.sessionId, player)
    this.sessions.set(client.sessionId, session)
    activeByUid.set(uid, { room: this, client })
    console.log(`[lobby ${this.lobbyNumber}] ${player.name} joined (${this.state.players.size}/${this.maxClients})`)
  }

  /**
   * The save a first-time account starts from: the Boxity guest accounts this
   * browser played as before signing in (newest first), then this browser's
   * own guest id. Each guest save can only ever go to one account.
   */
  async takeGuestSave(uid, auth) {
    const candidates = [...(auth.carriedFrom ?? []).map((id) => accountUid(id)), auth.guestUid].filter((id) => id && id !== uid)
    for (const guestUid of candidates) {
      // Still playing as that guest somewhere on this server: save it first.
      const live = activeByUid.get(guestUid)
      if (live) live.room.persist(live.client.sessionId)
      const profile = await claimGuestSave(guestUid, uid)
      if (profile) {
        console.log(`[lobby ${this.lobbyNumber}] ${uid} takes over the guest save ${guestUid}`)
        return profile
      }
    }
    return null
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    const session = this.sessions.get(client.sessionId)
    this.persist(client.sessionId)
    if (player && session) rememberForStats(session.uid, player)
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
    saveProfile(session.uid, player)
  }

  persistAll() {
    for (const sessionId of this.sessions.keys()) this.persist(sessionId)
  }

  /* -------------------------------------------------------------------------
   * Jumps
   * ----------------------------------------------------------------------- */

  /**
   * One step's or jump's XP (every multiplier; 4% are lucky ×5), reported to
   * the client in batches. `pad` is the rate of the jump pad that made it (0:
   * by hand or foot).
   */
  jump(player, session, pad = 0) {
    let gain = xpPerJump(player)
    const lucky = Math.random() < CONFIG.luckyChance
    if (lucky) gain *= CONFIG.luckyMult
    const p = session.pending
    p.gain += gain
    p.jumps += 1
    if (lucky) p.lucky += 1
    if (pad) p.pad = pad
    const levelUp = addXp(player, gain)
    if (levelUp) this.levelUp(session.client, player, levelUp)
  }

  /* -------------------------------------------------------------------------
   * Simulation: jump pads, gain reports, stage progress
   * ----------------------------------------------------------------------- */

  tick(delta = 100) {
    const now = Date.now()
    const dt = Math.min(0.5, Math.max(0, delta / 1000))

    this.state.players.forEach((player, sessionId) => {
      const session = this.sessions.get(sessionId)
      if (!session) return

      // Jump pads bounce you (AFK) and pay at their rate; ten minutes on one earns a 2x boost.
      const pad = padAt(layout, player.x, player.y, player.z)
      if (pad && padOpen(player, pad)) {
        session.padAcc += pad.rate * dt
        while (session.padAcc >= 1) {
          session.padAcc -= 1
          this.jump(player, session, pad.rate)
        }
        session.padSeconds += dt
        if (session.padSeconds >= CONFIG.afkBoostAfter) {
          session.padSeconds = 0
          player.boostUntil = Math.max(player.boostUntil, now) + CONFIG.afkBoostMinutes * 60_000
          session.client.send('afkBoost', { minutes: CONFIG.afkBoostMinutes })
        }
      } else {
        session.padAcc = 0
        session.padSeconds = 0
      }

      if (now - session.lastFlushAt >= GAIN_FLUSH_MS) {
        session.lastFlushAt = now
        const p = session.pending
        if (p.jumps) {
          bumpCounter(player, session, 'jumps', p.jumps)
          session.client.send('gain', { n: Math.round(p.gain * 100) / 100, jumps: p.jumps, lucky: p.lucky, pad: p.pad })
          session.pending = { gain: 0, jumps: 0, lucky: 0, pad: 0 }
        }
      }

      // Stage progress: standing on a plateau reached by a believable run, through its door.
      const stage = stageAt(layout, player.z)
      if (
        stage &&
        stage.index > player.bestStage &&
        stageOpen(player, stage.index) &&
        onPlateau(stage, player.y, player.z) &&
        this.runReached(session, stage)
      ) {
        player.bestStage = stage.index
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
    const dt = Math.min(0.5, Math.max(0.03, (now - session.lastMoveAt) / 1000))
    session.lastMoveAt = now
    // Back on the ground: a fresh set of jumps.
    if (!m.a) session.airJumps = 0

    // Faster than this build could ever run: a teleport. Only server-approved
    // ones (checkpoint, respawn) and trips home keep the run going.
    const speed = playerMoveStats(player).speed
    const allowed = speed * dt * 1.6 + 12
    const teleported = dist > allowed
    if (teleported) {
      const expect = session.expect
      if (expect && now < expect.until && Math.hypot(x - expect.x, z - expect.z) < 6) {
        // A checkpoint starts a new run there; a respawn carries the old one on.
        if (!expect.keepRun) session.run = newRun(z, now)
        session.expect = null
      } else if (!inLobby(z)) {
        session.run = null
      }
      session.stepDist = 0
    } else if (!m.a && !player.air) {
      // Steps: ground actually run, never more than these boots can run in the time.
      session.stepDist += Math.min(dist, speed * dt * STEP_SLACK + 0.05)
      let n = 0
      while (session.stepDist >= CONFIG.stepStuds && n < MAX_STEPS_PER_MOVE) {
        session.stepDist -= CONFIG.stepStuds
        this.jump(player, session)
        n += 1
      }
      session.stepDist = Math.min(session.stepDist, CONFIG.stepStuds)
    }

    player.x = x
    player.y = y
    player.z = z
    player.r = num(m.r, player.r)
    player.s = Math.min(Math.max(num(m.s), 0), 400)
    player.air = Boolean(m.a)
    if (Number.isInteger(m.f)) player.flips = m.f & 0xffff
    player.dead = Boolean(m.d)

    // In a world's lobby the run (re)starts; leaving it starts the clock.
    if (inLobby(z)) session.run = newRun(z, now)
    else if (session.run) {
      // When the run first entered each stage (for the par-time star).
      const stage = stageAt(layout, z)
      if (stage && !session.run.entered[stage.index]) session.run.entered[stage.index] = now
    }

    // Remember where the player stood on the course (a respawn can put them
    // back on a platform from here): a point every 1.5 studs, or every second
    // when standing still.
    const last = session.groundTrail[session.groundTrail.length - 1]
    if (!player.air && !inLobby(z) && (!last || now - last.at > 1000 || Math.hypot(x - last.x, z - last.z) > 1.5)) {
      session.groundTrail.push({ x, y, z, at: now })
      if (session.groundTrail.length > GROUND_TRAIL) session.groundTrail.shift()
    }
  }

  /**
   * A jump the player made: XP, as long as it's one their level allows in
   * this air-time (the ground jump plus their mid-air ones) and they're not
   * jumping faster than a few a second (a macro).
   */
  onJump(_client, player, session) {
    const now = Date.now()
    const w = session.jumpWindow
    if (now - w.start > 1000) {
      w.start = now
      w.count = 0
    }
    if (w.count >= CONFIG.maxJumpRate) return
    if (session.airJumps >= playerMoveStats(player).jumps) return
    w.count += 1
    session.airJumps += 1
    this.jump(player, session)
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
    if (!stageOpen(player, index)) {
      const need = stageNeeds(index)
      this.reply(client, 'pad', { ok: false, code: 'locked', boot: need.boot, rebirths: need.rebirths })
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
    // Stars: 1 for the clear, +1 without falling, +1 more under par time.
    const run = session.run
    const seconds = (now - (run.entered[index] ?? run.at)) / 1000
    const par = stagePar(stage)
    const earned = run.fell ? 1 : seconds <= par ? 3 : 2
    const before = starsOf(player)[index - 1]
    if (earned > before) player.stars = raiseStars(player.stars, index, earned)
    // One pad per run: the next run starts back in the lobby.
    session.run = null
    const wins = stageWins(index, player, kind === 'double')
    player.wins += wins
    bumpCounter(player, session, 'wins', wins)
    bumpCounter(player, session, 'runs', 1)
    if (index > player.bestStage) player.bestStage = index
    client.send('reward', { wins, stage: index, kind, stars: earned, before, seconds: Math.round(seconds * 10) / 10, par })
    this.feed(client, { kind: 'stage', name: player.name, value: index })
  }

  /**
   * Falling: back to the last checkpoint — a platform this run stood on — for
   * free. The run carries on (it just can't earn the no-fall star).
   */
  onRespawn(client, player, session, { x, y, z }) {
    if (![x, y, z].every(Number.isFinite)) {
      this.reply(client, 'respawn', fail('invalid'))
      return
    }
    const found = platformAt(layout, x, y - 0.2, z)
    const spot = found && checkpointOn(found.platform, x)
    const now = Date.now()
    const p = found?.platform
    const stoodOn =
      p &&
      session.groundTrail.some((g) => now - g.at < RESPAWN_MEMORY_MS && g.x >= p.x0 - 1 && g.x <= p.x1 + 1 && g.z <= p.z0 + 1 && g.z >= p.z1 - 1 && Math.abs(g.y - p.y) < 2)
    if (!spot || !stoodOn || Math.hypot(spot.x - x, spot.z - z) > 1 || Math.abs(spot.y - y) > 1) {
      this.reply(client, 'respawn', fail('invalid'))
      return
    }
    if (session.run) session.run.fell = true
    bumpCounter(player, session, 'falls', 1)
    session.expect = { x: spot.x, z: spot.z, until: now + 6000, keepRun: true }
    this.reply(client, 'respawn', { ok: true, code: 'respawn', ...spot, stage: found.stage.index })
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

  /** Through a world door: to that world's lobby, if you've rebirthed enough. */
  onWorld(client, player, session, { id }) {
    const now = Date.now()
    if (now - session.lastCheckpointAt < 1000) return
    const world = layout.worlds.find((w) => w.id === id)
    if (!world) {
      this.reply(client, 'world', fail('unknown'))
      return
    }
    if (player.rebirths < world.rebirths) {
      this.reply(client, 'world', { ok: false, code: 'locked', need: world.rebirths })
      return
    }
    session.lastCheckpointAt = now
    session.expect = { x: world.spawn.x, z: world.spawn.z, until: now + 6000 }
    this.reply(client, 'world', { ok: true, code: 'world', id, ...world.spawn })
  }
}

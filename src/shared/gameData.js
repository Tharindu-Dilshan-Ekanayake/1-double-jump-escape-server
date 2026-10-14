/**
 * Game rules shared by the client and the Colyseus server.
 *
 * The server repo keeps an identical copy in `src/shared/` — after editing anything
 * in this folder run `npm run sync-shared` in the server repo. Everything that
 * decides a reward (prices, multipliers, pad positions) lives here so both sides
 * always agree.
 */

export const GAME_TITLE = '+1 Double Jump Escape'
export const ROOM_NAME = 'jump_escape'
/** Colyseus locks a room at this size; the next `joinOrCreate` opens a new lobby. */
export const MAX_PLAYERS_PER_LOBBY = 8

/** Units are Roblox-style studs: a character is ~5 tall. */
export const PHYSICS = Object.freeze({
  gravity: 150,
  radius: 1.1,
  height: 5.2,
  stepHeight: 1.3,
  maxMoveSpeed: 240,
  /** Terminal falling speed. */
  maxFallSpeed: 190,
})

/** The server pays "+Jump" at most this often while a player is active. */
export const GAIN_TICK_MS = 1000
export const MAX_LEVEL = 15
export const MAX_JUMPS = 5
export const CHEST_COOLDOWN_MS = 15 * 60_000
/** The daily reward refills after 20 h, so playing at the same time every day always works. */
export const DAILY_COOLDOWN_MS = 20 * 60 * 60_000
/** Missing a day for longer than this resets the daily streak. */
export const DAILY_STREAK_WINDOW_MS = 48 * 60 * 60_000
export const DAILY_MAX_STREAK = 7

/** Small seeded PRNG so every client and the server generate the same things. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------------------------------
 * Boots: "+N Jump/s" while you play, plus run speed and jump height.
 * Bought once with Wins on the pedestals in the lobby, then equipped.
 * The Hydra boots are limited: only `limited` pairs exist across every server.
 * ------------------------------------------------------------------------- */

export const BOOTS = [
  { id: 'starter', name: 'Starter Boots', rate: 1, speed: 0, height: 0, price: 0, color: '#8a5a34', accent: '#d9b38c' },
  { id: 'bouncy', name: 'Bouncy Boots', rate: 2, speed: 1, height: 0.5, price: 3, color: '#3fd16b', accent: '#ffffff' },
  { id: 'spring', name: 'Spring Boots', rate: 5, speed: 2, height: 1, price: 15, color: '#2f9cf6', accent: '#ffe23a' },
  { id: 'rocket', name: 'Rocket Boots', rate: 25, speed: 4, height: 2, price: 100, color: '#ff8a1f', accent: '#ffffff', glow: '#ff6a00' },
  { id: 'lava', name: 'Lava Boots', rate: 50, speed: 6, height: 3, price: 500, color: '#2a1a14', accent: '#ff5a12', glow: '#ff4d00' },
  { id: 'frost', name: 'Frost Boots', rate: 100, speed: 9, height: 4.5, price: 2500, color: '#bfefff', accent: '#6fd2ff', glow: '#9fe8ff' },
  { id: 'thunder', name: 'Thunder Boots', rate: 250, speed: 12, height: 6, price: 10_000, color: '#2b2f3a', accent: '#ffe23a', glow: '#fff07a' },
  { id: 'galaxy', name: 'Galaxy Boots', rate: 500, speed: 16, height: 8, price: 35_000, color: '#5b2bd9', accent: '#ff9df5', glow: '#b98bff' },
  { id: 'rainbow', name: 'Rainbow Boots', rate: 1000, speed: 20, height: 10, price: 100_000, color: '#ff4d4d', accent: '#ffd23f', glow: 'rainbow' },
  { id: 'diamond', name: 'Diamond Boots', rate: 2000, speed: 26, height: 13, price: 500_000, color: '#8ff6ff', accent: '#ffffff', glow: '#c9fbff' },
  {
    id: 'hydra',
    name: 'Abyssal Hydra Boots',
    rate: 20_000,
    speed: 34,
    height: 17,
    price: 2_500_000,
    limited: 500,
    color: '#0b3b4a',
    accent: '#2fffd0',
    glow: '#2fffd0',
  },
]

/* ---------------------------------------------------------------------------
 * Trampolines: stand on one and it bounces you, multiplying your Jump gain.
 * ------------------------------------------------------------------------- */

export const TRAMPOLINES = [
  { id: 't1', mult: 1, price: 0, color: '#e8433a', fx: 'none' },
  { id: 't3', mult: 3, price: 10, color: '#ffd23a', fx: 'sparkle' },
  { id: 't9', mult: 9, price: 60, color: '#3fb8ff', fx: 'lightning' },
  { id: 't25', mult: 25, price: 300, color: '#f4f4f4', fx: 'dust' },
  { id: 't100', mult: 100, price: 2500, color: '#b45cff', fx: 'flame' },
  { id: 't1000', mult: 1000, price: 40_000, color: 'rainbow', fx: 'rainbow' },
]

/* ---------------------------------------------------------------------------
 * Trails: the stripes you leave behind. `bonus` adds to the Jump multiplier.
 * ------------------------------------------------------------------------- */

export const TRAILS = [
  { id: 'white', name: 'Cloud Stripes', bonus: 0, price: 0, colors: ['#ffffff'] },
  { id: 'sky', name: 'Sky Stripes', bonus: 0.05, price: 25, colors: ['#bfe9ff', '#3fa8ff'] },
  { id: 'mint', name: 'Mint Fizz', bonus: 0.1, price: 80, colors: ['#c9ffe4', '#2fdc8a'] },
  { id: 'candy', name: 'Candy Swirl', bonus: 0.15, price: 250, colors: ['#ff8fd1', '#ffffff'] },
  { id: 'fire', name: 'Fire Blaze', bonus: 0.25, price: 900, colors: ['#fff07a', '#ff4d00'], glow: true },
  { id: 'toxic', name: 'Toxic Slime', bonus: 0.35, price: 3000, colors: ['#e6ff7a', '#2fff7a'], glow: true },
  { id: 'galaxy', name: 'Galaxy Dust', bonus: 0.5, price: 12_000, colors: ['#ff6ef7', '#7b3bff', '#2fd0ff'], glow: true },
  { id: 'rainbow', name: 'Rainbow Road', bonus: 0.75, price: 50_000, colors: ['#ff3b3b', '#ffb03b', '#fff03b', '#3bff6e', '#3bb5ff', '#a03bff'], glow: true },
  { id: 'gold', name: 'Golden Glory', bonus: 1, price: 250_000, colors: ['#fff6c4', '#ffc933'], glow: true },
]

/* ---------------------------------------------------------------------------
 * Stages. Each one ends on a plateau with a Return pad (+wins, home) and a 2x
 * Wins pad. The obstacle in front of a plateau is sized (see layout.js) so the
 * stage's reference build — `level`, `boot` and `rebirths` — can clear it with
 * room to spare and the build before it can't. Stages from 11 on also sit
 * behind a rebirth door.
 *   gate 'gap'  — a long jump across the lava
 *   gate 'wall' — a tall wall to climb by chaining jumps
 * ------------------------------------------------------------------------- */

export const STAGES = [
  { name: 'Grassy Start', icon: '🌱', theme: 'starter', wins: 1, level: 2, boot: 'starter', rebirths: 0, gate: 'gap' },
  { name: 'Brick Lava', icon: '🧱', theme: 'brick', wins: 1, level: 3, boot: 'starter', rebirths: 0, gate: 'wall' },
  { name: 'Lava Pit', icon: '🔥', theme: 'lava', wins: 3, level: 5, boot: 'starter', rebirths: 0, gate: 'gap' },
  { name: 'Sandy Dunes', icon: '🏜️', theme: 'desert', wins: 10, level: 6, boot: 'bouncy', rebirths: 0, gate: 'wall' },
  { name: 'Shark Bay', icon: '🦈', theme: 'shark', wins: 20, level: 7, boot: 'spring', rebirths: 0, gate: 'gap' },
  { name: 'Frozen Falls', icon: '🧊', theme: 'ice', wins: 35, level: 8, boot: 'spring', rebirths: 0, gate: 'wall' },
  { name: 'Candy Land', icon: '🍭', theme: 'candy', wins: 60, level: 10, boot: 'spring', rebirths: 0, gate: 'gap' },
  { name: 'Jungle Run', icon: '🌴', theme: 'jungle', wins: 100, level: 11, boot: 'rocket', rebirths: 0, gate: 'wall' },
  { name: 'Neon City', icon: '🌃', theme: 'neon', wins: 160, level: 13, boot: 'rocket', rebirths: 0, gate: 'gap' },
  { name: 'Volcano', icon: '🌋', theme: 'volcano', wins: 250, level: 15, boot: 'lava', rebirths: 0, gate: 'wall' },
  { name: 'Sky Castle', icon: '☁️', theme: 'cloud', wins: 400, level: 15, boot: 'lava', rebirths: 1, gate: 'gap' },
  { name: 'Toxic Lab', icon: '☣️', theme: 'toxic', wins: 650, level: 15, boot: 'frost', rebirths: 2, gate: 'wall' },
  { name: 'Haunted Halls', icon: '👻', theme: 'haunted', wins: 1000, level: 15, boot: 'frost', rebirths: 3, gate: 'gap' },
  { name: 'Crystal Caves', icon: '💎', theme: 'crystal', wins: 1600, level: 15, boot: 'thunder', rebirths: 4, gate: 'wall' },
  { name: 'Robo Factory', icon: '🤖', theme: 'factory', wins: 2500, level: 15, boot: 'thunder', rebirths: 6, gate: 'gap' },
  { name: 'Sakura Garden', icon: '🌸', theme: 'sakura', wins: 4000, level: 15, boot: 'galaxy', rebirths: 8, gate: 'wall' },
  { name: 'Magma Core', icon: '☄️', theme: 'magma', wins: 6500, level: 15, boot: 'galaxy', rebirths: 10, gate: 'gap' },
  { name: 'Space Station', icon: '🚀', theme: 'space', wins: 10_000, level: 15, boot: 'rainbow', rebirths: 13, gate: 'wall' },
  { name: 'Galaxy Rift', icon: '🌌', theme: 'galaxy', wins: 16_000, level: 15, boot: 'rainbow', rebirths: 16, gate: 'gap' },
  { name: 'The Escape', icon: '🏆', theme: 'golden', wins: 25_000, level: 15, boot: 'diamond', rebirths: 20, gate: 'wall' },
]

export const STAGE_COUNT = STAGES.length

/*
 * Stage stars (the three under each node of the race tracker):
 *   1 = cleared, 2 = cleared without a revive, 3 = that, and under par time.
 * Kept per player as a string of digits, one per stage ('3210000...').
 */
export const MAX_STARS = 3

export function starsOf(player) {
  const text = String(player?.stars || '')
  return STAGES.map((_, i) => Math.min(MAX_STARS, Number(text[i]) || 0))
}

export const totalStars = (player) => starsOf(player).reduce((sum, n) => sum + n, 0)

/** The stars text with stage `index` raised to at least `value`. */
export function raiseStars(text, index, value) {
  const list = starsOf({ stars: text })
  list[index - 1] = Math.max(list[index - 1], Math.min(MAX_STARS, value))
  return list.join('')
}

/* ---------------------------------------------------------------------------
 * Lookups & helpers
 * ------------------------------------------------------------------------- */

const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]))
export const BOOT_BY_ID = byId(BOOTS)
export const TRAMPOLINE_BY_ID = byId(TRAMPOLINES)
export const TRAIL_BY_ID = byId(TRAILS)

/** Owned lists travel as comma-separated strings in the room state. */
export const parseList = (value) => (value ? String(value).split(',').filter(Boolean) : [])

/* ---------------------------------------------------------------------------
 * Progression formulas
 * ------------------------------------------------------------------------- */

/** Jump XP to finish `level` at 0 rebirths. Level 15 is MAX. */
const LEVEL_XP = [0, 15, 50, 150, 400, 1000, 2200, 4500, 8000, 13_000, 21_000, 33_000, 50_000, 75_000, 110_000]
/** Every rebirth makes each level this much longer (and pays +50% Jump to make up for most of it). */
export const XP_GROWTH = 1.75

export function xpForLevel(level, rebirths = 0) {
  if (level >= MAX_LEVEL) return Infinity
  return Math.round(LEVEL_XP[Math.max(1, level)] * XP_GROWTH ** Math.max(0, rebirths))
}

/** Total jumps per air-time: the ground jump plus mid-air jumps, +1 per level up to 5. */
export const jumpsFor = (level) => Math.max(1, Math.min(MAX_JUMPS, level))

/** Each rebirth: +50% Jump gain, +10% Wins, +3% run speed and jump height (up to +75%). */
export const rebirthJumpBonus = (rebirths) => rebirths * 0.5
export const rebirthWinsBonus = (rebirths) => rebirths * 0.1
export const rebirthMoveBonus = (rebirths) => Math.min(rebirths, 25) * 0.03
/** +10% per other player in the lobby, capped at +50%. */
export const friendBonus = (others) => Math.min(Math.max(others, 0), 5) * 0.1

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Movement for a level, boot and rebirth count: jumps per air-time, run speed
 * (studs/s) and the height of one jump (studs).
 */
export function moveStats(level, bootId = 'starter', rebirths = 0) {
  const boot = BOOT_BY_ID[bootId] ?? BOOTS[0]
  const m = 1 + rebirthMoveBonus(rebirths)
  return {
    jumps: jumpsFor(level),
    speed: round1((16 + 2.2 * (level - 1) + boot.speed) * m),
    height: round1((7 + 0.8 * (level - 1) + boot.height) * m),
  }
}

export const playerMoveStats = (player) => moveStats(player?.level ?? 1, player?.boot ?? 'starter', player?.rebirths ?? 0)

/** Every multiplier that applies to one "+Jump" tick, split out for the UI. */
export function gainBreakdown(player, { trampMult = 1, others = 0, now = Date.now() } = {}) {
  const boot = BOOT_BY_ID[player.boot]?.rate ?? 1
  const trail = TRAIL_BY_ID[player.trail]?.bonus ?? 0
  const rebirth = 1 + rebirthJumpBonus(player.rebirths ?? 0)
  const friends = 1 + friendBonus(others)
  const pass = player.pass2xJump ? 2 : 1
  const boost = (player.boostUntil ?? 0) > now ? 2 : 1
  return {
    boot,
    tramp: trampMult,
    trail,
    rebirth,
    friends,
    pass,
    boost,
    total: boot * trampMult * (1 + trail) * rebirth * friends * pass * boost,
  }
}

/** Wins from a stage pad (doubled on the 2x pad, which needs the 2x Wins pass). */
export function padWins(stageWins, player, double = false) {
  return Math.max(1, Math.round(stageWins * (1 + rebirthWinsBonus(player?.rebirths ?? 0)) * (double ? 2 : 1)))
}

/** Rebirth needs MAX level; it resets your level (and jumps) to 1. */
export const canRebirth = (player) => (player?.level ?? 1) >= MAX_LEVEL

/** How close you are to rebirthing, 0..1 (shown on the Rebirth button). */
export function rebirthProgress(player) {
  if (!player) return 0
  if (player.level >= MAX_LEVEL) return 1
  return Math.min(0.99, (player.level - 1 + Math.min(1, player.xp / xpForLevel(player.level, player.rebirths))) / (MAX_LEVEL - 1))
}

/** A "unit" of Wins that grows with how far you've got (gifts, chest, daily). */
export function winsUnit(player) {
  const best = Math.max(0, Math.min(STAGE_COUNT, player?.bestStage ?? 0))
  return best ? Math.max(1, Math.round(STAGES[best - 1].wins * 0.5)) : 1
}

/** Wins to revive where you fell instead of starting over. */
export const reviveCost = (stageIndex) => Math.max(1, Math.ceil((STAGES[stageIndex - 1]?.wins ?? 1) * 0.25))

/* ---------------------------------------------------------------------------
 * Shop: passes and Jump packs, all bought with Wins.
 * ------------------------------------------------------------------------- */

export const PRODUCTS = {
  pass2xJump: { name: '2x Jump', price: 150 },
  pass2xWins: { name: '2x Wins', price: 400 },
  jump10k: { name: '+10k Jump', price: 40, jump: 10_000 },
  jump100k: { name: '+100k Jump', price: 300, jump: 100_000 },
  jump1m: { name: '+1M Jump', price: 2500, jump: 1_000_000 },
  jump10m: { name: '+10M Jump', price: 20_000, jump: 10_000_000 },
}

export const CODES = {
  RELEASE: { wins: 15 },
  ESCAPE: { wins: 10 },
  BOOTS: { wins: 20 },
  DOUBLEJUMP: { jump: 2500 },
  TRAMPOLINE: { boost: 10 },
}

/* ---------------------------------------------------------------------------
 * Playtime gifts (per session) — the longer you play, the bigger they get.
 *  wins  — `amount` x your Wins unit
 *  boost — 2x Jump for `amount` minutes
 *  jump  — `amount` seconds of Jump at your best trampoline
 * ------------------------------------------------------------------------- */

export const GIFTS = [
  { minutes: 1, kind: 'wins', amount: 1 },
  { minutes: 3, kind: 'boost', amount: 5 },
  { minutes: 6, kind: 'wins', amount: 3 },
  { minutes: 10, kind: 'jump', amount: 120 },
  { minutes: 15, kind: 'wins', amount: 6 },
  { minutes: 20, kind: 'boost', amount: 10 },
  { minutes: 30, kind: 'wins', amount: 12 },
  { minutes: 45, kind: 'jump', amount: 600 },
  { minutes: 60, kind: 'wins', amount: 25 },
  { minutes: 90, kind: 'boost', amount: 30 },
  { minutes: 120, kind: 'wins', amount: 50 },
  { minutes: 180, kind: 'wins', amount: 100 },
]

/** Best trampoline multiplier a player owns (for "jump" gifts). */
export function bestTrampMult(player) {
  const owned = new Set(parseList(player?.tramps))
  let best = 1
  for (const t of TRAMPOLINES) if ((t.price === 0 || owned.has(t.id)) && t.mult > best) best = t.mult
  return best
}

/** What a gift is worth to this player right now: { wins?, jump?, boost? }. */
export function giftReward(gift, player) {
  if (gift.kind === 'wins') return { wins: gift.amount * winsUnit(player) }
  if (gift.kind === 'boost') return { boost: gift.amount }
  const rate = gainBreakdown(player, { trampMult: bestTrampMult(player), now: 0 }).total
  return { jump: Math.round(gift.amount * rate) }
}

export function dailyReward(player, streak) {
  return { wins: (2 + Math.min(streak, DAILY_MAX_STREAK)) * winsUnit(player) }
}

export const chestReward = (player) => ({ wins: 2 * winsUnit(player) })

/* ---------------------------------------------------------------------------
 * Goals: the banner at the top ("GET 3 WINS! (2/3)"). One at a time; finishing
 * it pays the reward and the next one starts. After the scripted list they
 * keep coming, each set a little above where the player is.
 *   kind: level | stage | wins (lifetime earned) | boots | tramps | rebirths | jumps
 * ------------------------------------------------------------------------- */

const SCRIPTED_GOALS = [
  { text: 'REACH LEVEL 2!', kind: 'level', target: 2, reward: { wins: 1 } },
  { text: 'BEAT STAGE 1!', kind: 'stage', target: 1, reward: { wins: 1 } },
  { text: 'GET 3 WINS!', kind: 'wins', target: 3, reward: { wins: 2 } },
  { text: 'BUY NEW BOOTS!', kind: 'boots', target: 2, reward: { jump: 60 } },
  { text: 'BEAT STAGE 3!', kind: 'stage', target: 3, reward: { wins: 3 } },
  { text: 'UNLOCK A TRAMPOLINE!', kind: 'tramps', target: 2, reward: { wins: 5 } },
  { text: 'REACH LEVEL 5!', kind: 'level', target: 5, reward: { wins: 5 } },
  { text: 'GET 25 WINS!', kind: 'wins', target: 25, reward: { wins: 10 } },
  { text: 'BEAT STAGE 5!', kind: 'stage', target: 5, reward: { jump: 2000 } },
  { text: 'OWN 4 BOOTS!', kind: 'boots', target: 4, reward: { wins: 20 } },
  { text: 'REACH LEVEL 10!', kind: 'level', target: 10, reward: { wins: 40 } },
  { text: 'BEAT STAGE 8!', kind: 'stage', target: 8, reward: { wins: 60 } },
  { text: 'GET 500 WINS!', kind: 'wins', target: 500, reward: { wins: 100 } },
  { text: 'REACH MAX LEVEL!', kind: 'level', target: MAX_LEVEL, reward: { wins: 150 } },
  { text: 'REBIRTH!', kind: 'rebirths', target: 1, reward: { wins: 200 } },
  { text: 'BEAT STAGE 11!', kind: 'stage', target: 11, reward: { wins: 300 } },
  { text: 'JUMP 2,000 TIMES!', kind: 'jumps', target: 2000, reward: { wins: 250 } },
  { text: 'REBIRTH 3 TIMES!', kind: 'rebirths', target: 3, reward: { wins: 500 } },
  { text: 'BEAT STAGE 13!', kind: 'stage', target: 13, reward: { wins: 800 } },
  { text: 'GET 10K WINS!', kind: 'wins', target: 10_000, reward: { wins: 1500 } },
]

export const SCRIPTED_GOAL_COUNT = SCRIPTED_GOALS.length
const ENDLESS_KINDS = ['rebirths', 'wins', 'jumps', 'stage', 'stars']

/** The value a goal of `kind` measures for a player. */
export function goalValue(kind, player, counters = {}) {
  switch (kind) {
    case 'level':
      // Rebirthing drops you back to level 1; level goals stay done after that.
      return player.rebirths > 0 ? MAX_LEVEL : player.level
    case 'stage':
      return player.bestStage || 0
    case 'wins':
      return counters.wins || 0
    case 'boots':
      return parseList(player.bootsOwned).length
    case 'tramps':
      return parseList(player.tramps).length
    case 'rebirths':
      return player.rebirths || 0
    case 'jumps':
      return counters.jumps || 0
    case 'stars':
      return totalStars(player)
    default:
      return 0
  }
}

const niceRound = (n) => {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1)
  return Math.ceil(n / p) * p
}

/**
 * Goal number `index`. Scripted goals are fixed; endless ones need the player's
 * current values to pick a target just above them (`target` is stored when the
 * goal starts, so it doesn't run away while you chase it).
 */
export function goalAt(index, player, counters = {}, storedTarget = 0) {
  if (index < SCRIPTED_GOALS.length) return { index, ...SCRIPTED_GOALS[index] }
  const n = index - SCRIPTED_GOALS.length
  let kind = ENDLESS_KINDS[n % ENDLESS_KINDS.length]
  // Nothing left to beat once the whole course is done.
  if (kind === 'stage' && (player.bestStage || 0) >= STAGE_COUNT && !storedTarget) kind = 'wins'
  if (kind === 'stars' && totalStars(player) >= STAGE_COUNT * MAX_STARS && !storedTarget) kind = 'jumps'
  const value = goalValue(kind, player, counters)
  let target = storedTarget
  if (!target) {
    if (kind === 'rebirths') target = value + 1
    else if (kind === 'stage') target = Math.min(STAGE_COUNT, value + 1)
    else if (kind === 'stars') target = Math.min(STAGE_COUNT * MAX_STARS, value + 3)
    else if (kind === 'wins') target = niceRound(Math.max(100, value * 2))
    else target = niceRound(value + 1000 * (1 + Math.floor(n / 4)))
  }
  const text = {
    rebirths: target === 1 ? 'REBIRTH!' : `REBIRTH ${formatNumber(target)} TIMES!`,
    stage: `BEAT STAGE ${target}!`,
    wins: `GET ${formatNumber(target).toUpperCase()} WINS!`,
    jumps: `JUMP ${formatNumber(target).toUpperCase()} TIMES!`,
    stars: `EARN ${target} STAGE STARS!`,
  }[kind]
  return { index, kind, target, text, reward: { wins: Math.max(10, 3 * winsUnit(player)) }, endless: true }
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

/** 1160 -> "1.16K", 1000 -> "1K", 12.5 -> "12.5". */
export function formatNumber(value) {
  let n = Number(value) || 0
  if (!Number.isFinite(n)) return '∞'
  const sign = n < 0 ? '-' : ''
  n = Math.abs(n)
  if (n < 1000) {
    return sign + String(parseFloat(n.toFixed(n < 10 ? 1 : 0)))
  }
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
  let unit = -1
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000
    unit += 1
  }
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2
  return sign + String(parseFloat(n.toFixed(digits))) + units[unit]
}

/** "4:05" style countdown. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "1,000x" — multipliers read better written out in full. */
export const multLabel = (mult) => `${Number(mult).toLocaleString('en-US')}x`

export function describeReward(reward) {
  const parts = []
  if (reward.wins) parts.push(`+${formatNumber(reward.wins)} Wins`)
  if (reward.jump) parts.push(`+${formatNumber(reward.jump)} Jump`)
  if (reward.boost) parts.push(`2x Jump for ${reward.boost} min`)
  return parts.join('  ')
}

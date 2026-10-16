/**
 * Game data shared by the client and the Colyseus server: physics, events,
 * stage names and themes, worlds, trails, stars and formatting.
 *
 * Progression (levels, jumps, speed, rebirths, Wins, boots, perks, pets,
 * jump pads, rewards, saves) lives in ./progression.js, re-exported here so
 * one import gets everything.
 *
 * The server repo keeps an identical copy in `src/shared/` — after editing anything
 * in this folder run `npm run sync-shared` in the server repo.
 */

import { STAGE_TABLE } from './progression.js'

export * from './progression.js'

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

/* ---------------------------------------------------------------------------
 * Events. Flip `enabled` (or let the dates pass) to switch an event off; no
 * other code changes are needed. While Halloween is on, the music and
 * ambience go spooky.
 * ------------------------------------------------------------------------- */

export const EVENTS = {
  halloween: {
    enabled: true,
    name: 'Halloween',
    start: '2026-10-01T00:00:00Z',
    end: '2026-11-04T00:00:00Z',
  },
}

/** True while Halloween is switched on and between its dates. */
export function halloweenActive(now = Date.now()) {
  const event = EVENTS.halloween
  return event.enabled && now >= Date.parse(event.start) && now < Date.parse(event.end)
}

export const halloweenEndsAt = () => Date.parse(EVENTS.halloween.end)

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
 * Trails: the stripes you leave behind. Cosmetic, bought with Wins — each
 * one once you've reached its stage, so your trail shows how far you've got.
 * ------------------------------------------------------------------------- */

export const TRAILS = [
  { id: 'white', name: 'Cloud Stripes', price: 0, stage: 0, colors: ['#ffffff'] },
  { id: 'sky', name: 'Sky Stripes', price: 15, stage: 2, colors: ['#bfe9ff', '#3fa8ff'] },
  { id: 'mint', name: 'Mint Fizz', price: 40, stage: 4, colors: ['#c9ffe4', '#2fdc8a'] },
  { id: 'candy', name: 'Candy Swirl', price: 100, stage: 6, colors: ['#ff8fd1', '#ffffff'] },
  { id: 'fire', name: 'Fire Blaze', price: 250, stage: 8, colors: ['#fff07a', '#ff4d00'], glow: true },
  { id: 'toxic', name: 'Toxic Slime', price: 900, stage: 10, colors: ['#e6ff7a', '#2fff7a'], glow: true },
  { id: 'galaxy', name: 'Galaxy Dust', price: 4000, stage: 13, colors: ['#ff6ef7', '#7b3bff', '#2fd0ff'], glow: true },
  { id: 'rainbow', name: 'Rainbow Road', price: 20_000, stage: 16, colors: ['#ff3b3b', '#ffb03b', '#fff03b', '#3bff6e', '#3bb5ff', '#a03bff'], glow: true },
  { id: 'gold', name: 'Golden Glory', price: 100_000, stage: 20, colors: ['#fff6c4', '#ffc933'], glow: true },
]

/** Can this player buy trail `trail` (reached its stage)? */
export const trailOpen = (player, trail) => (player?.bestStage ?? 0) >= (trail.stage ?? 0)

/* ---------------------------------------------------------------------------
 * Stages. "Stage N" hangs over the doorway into each one; each starts with
 * one long jump in, then flat platforms across the lava, and ends with a
 * Return pad (+Wins, home), a 2x Wins pad and the board saying what the next
 * one needs. What each stage needs (`level`, `boot`, `rebirths`) and what it
 * pays (`wins`) come from STAGE_TABLE in progression.js.
 * ------------------------------------------------------------------------- */

const STAGE_LOOKS = [
  { name: 'Lava Steps', icon: '🧱', theme: 'brick' },
  { name: "Don't Touch Red", icon: '🟥', theme: 'red' },
  { name: 'Lava Pit', icon: '🔥', theme: 'lava' },
  { name: 'Shark Bay', icon: '🦈', theme: 'shark' },
  { name: 'Spike Field', icon: '🔺', theme: 'spike' },
  { name: 'Frozen Falls', icon: '🧊', theme: 'ice' },
  { name: 'Candy Land', icon: '🍭', theme: 'candy' },
  { name: 'Jungle Run', icon: '🌴', theme: 'jungle' },
  { name: 'Neon City', icon: '🌃', theme: 'neon' },
  { name: 'Volcano', icon: '🌋', theme: 'volcano' },
  { name: 'Sky Castle', icon: '☁️', theme: 'cloud' },
  { name: 'Toxic Lab', icon: '☣️', theme: 'toxic' },
  { name: 'Haunted Halls', icon: '👻', theme: 'haunted' },
  { name: 'Crystal Caves', icon: '💎', theme: 'crystal' },
  { name: 'Robo Factory', icon: '🤖', theme: 'factory' },
  { name: 'Sakura Garden', icon: '🌸', theme: 'sakura' },
  { name: 'Magma Core', icon: '☄️', theme: 'magma' },
  { name: 'Space Station', icon: '🚀', theme: 'space' },
  { name: 'Galaxy Rift', icon: '🌌', theme: 'galaxy' },
  { name: 'The Escape', icon: '🏆', theme: 'golden' },
]

export const STAGES = STAGE_LOOKS.map((look, i) => ({ ...look, ...STAGE_TABLE[i] }))

export const STAGE_COUNT = STAGES.length

/*
 * Worlds. World 1 is the first ten stages, out of the lobby. World 2 is the
 * next ten, out of its own lobby, reached through the World 2 door at the back
 * of the first one — which only opens once you've rebirthed.
 */
export const WORLDS = [
  { id: 1, name: 'World 1', icon: '🏠', firstStage: 1, lastStage: 10, rebirths: 0 },
  { id: 2, name: 'World 2', icon: '🌌', firstStage: 11, lastStage: 20, rebirths: STAGE_TABLE[10].rebirths },
]

export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w]))

/** The world stage `index` belongs to. */
export const worldOfStage = (index) => WORLDS.find((w) => index >= w.firstStage && index <= w.lastStage) ?? WORLDS[0]

/*
 * Stage stars (the three under each node of the race tracker):
 *   1 = cleared, 2 = cleared without falling, 3 = that, and under par time.
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

export const TRAIL_BY_ID = Object.fromEntries(TRAILS.map((t) => [t.id, t]))

/** Owned lists travel as comma-separated strings in the room state. */
export const parseList = (value) => (value ? String(value).split(',').filter(Boolean) : [])

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

/** "3h 20m" for longer spans (offline earnings). */
export function formatSpan(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** A reward ({ wins, xp, boost }) as text. */
export function describeReward(reward) {
  const parts = []
  if (reward.wins) parts.push(`+${formatNumber(reward.wins)} Wins`)
  if (reward.xp) parts.push(`+${formatNumber(reward.xp)} XP`)
  if (reward.boost) parts.push(`2x XP for ${reward.boost} min`)
  return parts.join('  ')
}

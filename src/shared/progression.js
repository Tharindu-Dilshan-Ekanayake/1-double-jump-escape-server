/**
 * Progression: every number, catalog and formula for levels, jumps, speed,
 * rebirths, Wins, boots, jump pads, the Wins Shop, pets, titles, rewards and
 * saves — and nothing else.
 *
 * Pure (no three.js, no DOM, no React): the server applies it (it alone decides
 * what anyone earns), the client's progression store shows it, and
 * scripts/simulate.mjs balances it. The server repo keeps a synced copy (run
 * `npm run sync-shared` there after editing).
 *
 * The loop: walk and jump → every step and every jump pays +1 XP (×
 * multipliers); jump pads in the lobby bounce you for free (AFK) → level up
 * → more jumps → further stages → Wins → boots (more XP, more run speed, and
 * each pair opens the next two stages) → level 15 → Rebirth (+1 jump for
 * good, ×2 XP, more Wins, a better jump pad) → again, stronger.
 *
 *   What you have     comes from                         reset on rebirth?
 *   XP / level        steps, jumps, jump pads            yes (back to 0)
 *   jumps per air     your level (1 to 5) + rebirths     no (the rebirth part)
 *   run speed         your boots (+ Swift Feet)          no
 *   rebirths          rebirthing at level 15             no
 *   Wins              finishing stages                   no
 *   boots             bought with Wins, in order         no
 *   pets              eggs bought with Wins              no
 *   Wins Shop perks   bought with Wins                   no
 *   trails            Wins, once you've reached a stage  no
 *   lifetime levels   every level ever gained            no (titles and look)
 *
 * Every stage needs two things, and the course is built for exactly them
 * (see STAGE_TABLE and layout.js): a number of jumps — every gap in it needs
 * them — and the boots that open it (a door at its start stays shut without
 * them). World 2's stages need more jumps than five, so rebirths. Each pair
 * of boots opens two stages, so every pair is needed on the way.
 */

/* ---------------------------------------------------------------------------
 * Tuning
 * ------------------------------------------------------------------------- */

/** Read-only at runtime (scripts/simulate.mjs adjusts it while tuning). */
export const CONFIG = {
  /** Height of one jump (studs). Levels add jumps, not height. */
  jumpHeight: 8,
  /** Every step (this many studs of running) pays +1 XP, like every jump. */
  stepStuds: 3,
  /** Levels go from 0 to MAX (15) every time; then you rebirth. */
  maxLevel: 15,
  /**
   * XP from level L to L+1: xpBase × xpGrowth^L × xpScale(rebirths), where
   * each rebirth multiplies the XP a level takes by its entry in xpRebirth
   * (the last one repeats). The first levels fly by (2 jumps in about 20
   * seconds), then each takes a bit longer. Tuned by scripts/simulate.mjs for
   * the time each rebirth takes.
   */
  xpBase: 7.24,
  xpGrowth: 1.5,
  xpRebirth: [25.45, 5.71, 7.37, 8.53, 9.98],
  /** Per rebirth: +1 jump, ×2 XP (rebirthMult) and +50% Wins. */
  rebirthJumps: 1,
  rebirthWins: 0.5,
  /** 4% of jumps are lucky: ×5, with a gold sparkle. */
  luckyChance: 0.04,
  luckyMult: 5,
  /** Jumps a second that pay when you jump yourself (more is a macro). */
  maxJumpRate: 5,
  /** About how fast an average player jumps by hand (XP packs, the simulation). */
  handJumpRate: 1.6,
  /** A jump pad bounces you this often (the look; XP comes at the pad's rate). */
  padBounce: 0.5,
  /** 10 minutes AFK on a jump pad earns a 5-minute 2x boost. */
  afkBoostAfter: 10 * 60,
  afkBoostMinutes: 5,
  /** Away from the game: 30% of your best jump pad's rate, up to 8 hours. */
  offlineShare: 0.3,
  offlineMaxSeconds: 8 * 3600,
  /** Offline time shorter than this isn't worth a popup. */
  offlineMinSeconds: 120,
  petSlots: 3,
  petInventory: 60,
}

export const SAVE_VERSION = 5

/* ---------------------------------------------------------------------------
 * Levels and jumps
 * ------------------------------------------------------------------------- */

/** MAX level: 15, whatever your rebirths (a rebirth gives a jump instead). */
export const maxLevel = () => CONFIG.maxLevel

/** How much more XP every level takes after `rebirths` rebirths. */
export function xpScale(rebirths = 0) {
  const steps = CONFIG.xpRebirth
  let scale = 1
  for (let i = 0; i < rebirths; i += 1) scale *= steps[Math.min(i, steps.length - 1)]
  return scale
}

/** XP to go from `level` to the next, after `rebirths` rebirths. */
export const xpToNext = (level, rebirths = 0) => Math.round(CONFIG.xpBase * CONFIG.xpGrowth ** Math.max(0, level) * xpScale(rebirths))

/**
 * Total jumps per air-time (the ground jump plus mid-air ones): 1 at level 0,
 * 2 at 4, 3 at 8, 4 at 12, 5 at 15 — plus one for every rebirth.
 */
export const jumpsFor = (level, rebirths = 0) => 1 + Math.floor((Math.max(0, level) * 4) / 15) + CONFIG.rebirthJumps * Math.max(0, rebirths)

/** The first level with `jumps` jumps after `rebirths` rebirths (0 if you have them already; above MAX if you can't this rebirth). */
export const levelForJumps = (jumps, rebirths = 0) => Math.max(0, Math.ceil((15 * (jumps - 1 - CONFIG.rebirthJumps * rebirths)) / 4))

/** The first level with more jumps than `level`, or null at MAX. */
export function nextJumpLevel(level) {
  const now = jumpsFor(level)
  for (let l = level + 1; l <= CONFIG.maxLevel; l += 1) if (jumpsFor(l) > now) return l
  return null
}

/* ---------------------------------------------------------------------------
 * Boots: bought in order with Wins. Each pair multiplies the XP of every
 * jump, sets your run speed (faster = longer jumps) and opens two stages.
 * The Hydra is limited (only `limited` pairs across every server), so no
 * stage needs it: it's the flex at the top.
 * (`color`, `accent` and `glow` are how the boots look.)
 * ------------------------------------------------------------------------- */

export const BOOTS = [
  { id: 'starter', name: 'Fluffy Slippers', mult: 1, speed: 16, price: 0, color: '#ffb7d5', accent: '#ffffff' },
  { id: 'sneakers', name: 'Sneakers', mult: 1.5, speed: 19, price: 3, color: '#f4f6fb', accent: '#2f8cff' },
  { id: 'bouncy', name: 'Bouncy Boots', mult: 2, speed: 22, price: 5, color: '#3fd16b', accent: '#ffffff' },
  { id: 'rocket', name: 'Rocket Boots', mult: 3, speed: 25, price: 31, color: '#ff8a1f', accent: '#ffffff', glow: '#ff6a00' },
  { id: 'lava', name: 'Lava Boots', mult: 4, speed: 28, price: 74, color: '#2a1a14', accent: '#ff5a12', glow: '#ff4d00' },
  { id: 'frost', name: 'Frost Boots', mult: 5.5, speed: 31, price: 140, color: '#bfefff', accent: '#6fd2ff', glow: '#9fe8ff' },
  { id: 'thunder', name: 'Thunder Boots', mult: 7.5, speed: 34, price: 810, color: '#2b2f3a', accent: '#ffe23a', glow: '#fff07a' },
  { id: 'galaxy', name: 'Galaxy Boots', mult: 10, speed: 38, price: 4000, color: '#5b2bd9', accent: '#ff9df5', glow: '#b98bff' },
  { id: 'rainbow', name: 'Rainbow Boots', mult: 14, speed: 42, price: 19_000, color: '#ff4d4d', accent: '#ffd23f', glow: 'rainbow' },
  { id: 'diamond', name: 'Diamond Boots', mult: 19, speed: 46, price: 42_000, color: '#8ff6ff', accent: '#ffffff', glow: '#c9fbff' },
  { id: 'hydra', name: 'Abyssal Hydra Boots', mult: 26, speed: 50, price: 200_000, limited: 500, color: '#0b3b4a', accent: '#2fffd0', glow: '#2fffd0' },
]

export const BOOT_BY_ID = Object.fromEntries(BOOTS.map((b) => [b.id, b]))

/** A boot's place in the shop (0 = the slippers you start with). */
export const bootTier = (id) => Math.max(0, BOOTS.findIndex((b) => b.id === id))

const csvList = (value) => (value ? String(value).split(',').filter(Boolean) : [])

/** The best boots tier a player owns (what boot doors check). */
export function bestBootTier(player) {
  let best = 0
  for (const id of csvList(player?.bootsOwned)) {
    const i = BOOTS.findIndex((b) => b.id === id)
    if (i > best) best = i
  }
  return best
}

/* ---------------------------------------------------------------------------
 * Run speed and movement
 * ------------------------------------------------------------------------- */

/** Run speed (studs/s) in a pair of boots, with the Wins Shop's Swift Feet perk. */
export function speedFor(bootId = 'starter', speedPerk = 0) {
  const base = (BOOT_BY_ID[bootId] ?? BOOTS[0]).speed
  return round1(base * (1 + SHOP_PERKS.speed.per * speedPerk))
}

/** Movement: jumps per air-time (level and rebirths), run speed (boots, studs/s) and one jump's height (studs). */
export function moveStats(level, bootId = 'starter', speedPerk = 0, rebirths = 0) {
  return { jumps: jumpsFor(level, rebirths), speed: speedFor(bootId, speedPerk), height: CONFIG.jumpHeight }
}

export const playerMoveStats = (player) => moveStats(player?.level ?? 0, player?.boot ?? 'starter', player?.perkSpeed ?? 0, player?.rebirths ?? 0)

/** Steps a second running flat out in these boots. */
export const stepsPerSecond = (bootId, speedPerk = 0) => speedFor(bootId, speedPerk) / CONFIG.stepStuds

/* ---------------------------------------------------------------------------
 * Rebirth
 * ------------------------------------------------------------------------- */

export const rebirthMult = (rebirths = 0) => 2 ** Math.max(0, rebirths)
export const canRebirth = (player) => (player?.level ?? 0) >= maxLevel(player?.rebirths ?? 0)

/** 0..1 of the way to MAX level. */
export function rebirthProgress(player) {
  if (!player) return 0
  const max = maxLevel(player.rebirths)
  if (player.level >= max) return 1
  return Math.min(0.99, (player.level + Math.min(1, player.xp / xpToNext(player.level, player.rebirths))) / max)
}

/** Fields a rebirth resets, and to what. */
export const REBIRTH_RESETS = Object.freeze({ level: 0, xp: 0 })

/* ---------------------------------------------------------------------------
 * Jump pads: stand on one and it bounces you, paying XP at its rate (jumps a
 * second) while you're on it — AFK training. The first is free, the next two
 * are bought with Wins (and kept for good, through rebirths), and the best
 * three unlock with rebirths.
 * ------------------------------------------------------------------------- */

export const JUMP_PADS = [
  { id: 'pad1', name: 'Jump Pad', rate: 2, rebirths: 0, price: 0, color: '#3fd16b' },
  { id: 'pad2', name: 'Super Pad', rate: 3, rebirths: 0, price: 20, color: '#3fa8ff' },
  { id: 'pad3', name: 'Turbo Pad', rate: 4.5, rebirths: 0, price: 150, color: '#ffb81f' },
  { id: 'pad4', name: 'Hyper Pad', rate: 6.5, rebirths: 3, price: 0, color: '#ff5fb0' },
  { id: 'pad5', name: 'Mega Pad', rate: 9, rebirths: 4, price: 0, color: '#b45cff' },
  { id: 'pad6', name: 'Rainbow Pad', rate: 12, rebirths: 5, price: 0, color: 'rainbow' },
]

export const PAD_BY_ID = Object.fromEntries(JUMP_PADS.map((p) => [p.id, p]))
/**
 * Free pads are everyone's; the others once bought (`padsOwned`). `pad` may be
 * a JUMP_PADS entry or a layout pad: the rules come from its id.
 */
export function padOwned(player, pad) {
  const def = PAD_BY_ID[pad?.id]
  return Boolean(def) && (!def.price || csvList(player?.padsOwned).includes(def.id))
}
export function padOpen(player, pad) {
  const def = PAD_BY_ID[pad?.id]
  return Boolean(def) && (player?.rebirths ?? 0) >= def.rebirths && padOwned(player, def)
}

/** The best jump pad a player can use (jumps a second). */
export function bestPadRate(player) {
  let best = 0
  for (const pad of JUMP_PADS) if (padOpen(player, pad)) best = Math.max(best, pad.rate)
  return best
}

/* ---------------------------------------------------------------------------
 * The Wins Shop: permanent perks, each with levels.
 * ------------------------------------------------------------------------- */

export const SHOP_PERKS = {
  gain: { name: 'Jump Power', icon: '🦘', text: '+25% XP from every step & jump', per: 0.25, max: 10, base: 40, growth: 2.1 },
  wins: { name: 'Winner', icon: '🏆', text: '+10% Wins', per: 0.1, max: 10, base: 80, growth: 2.1 },
  speed: { name: 'Swift Feet', icon: '💨', text: '+4% run speed', per: 0.04, max: 5, base: 120, growth: 2.6 },
  luck: { name: 'Egg Luck', icon: '🍀', text: 'Rarer pets from eggs', per: 0.25, max: 5, base: 150, growth: 2.6 },
  slots: { name: 'Pet Slots', icon: '🐾', text: '+1 pet equipped', per: 1, max: 4, base: 250, growth: 3.2 },
}

export const PERK_FIELDS = { gain: 'perkGain', wins: 'perkWins', speed: 'perkSpeed', luck: 'perkLuck', slots: 'perkSlots' }
export const perkLevel = (player, id) => player?.[PERK_FIELDS[id]] ?? 0
export const perkPrice = (id, level) => Math.round(SHOP_PERKS[id].base * SHOP_PERKS[id].growth ** level)

/* ---------------------------------------------------------------------------
 * Pets: hatched from eggs (Wins), one pet of each rarity per egg. Equipped
 * pets add their bonus to the pets multiplier and follow you around.
 * ------------------------------------------------------------------------- */

export const RARITIES = [
  { id: 'common', name: 'Common', color: '#c3cad6', weight: 55 },
  { id: 'uncommon', name: 'Uncommon', color: '#5fd14a', weight: 28 },
  { id: 'rare', name: 'Rare', color: '#3fa8ff', weight: 12 },
  { id: 'epic', name: 'Epic', color: '#b45cff', weight: 4 },
  { id: 'legendary', name: 'Legendary', color: '#ffb81f', weight: 0.9 },
  { id: 'mythic', name: 'Mythic', color: '#ff3f6c', weight: 0.1 },
]

/** `shape` and colours are how the pet looks (see game/pets.js). */
export const EGGS = [
  {
    id: 'basic',
    name: 'Basic Egg',
    price: 48,
    rebirths: 0,
    color: '#fff4dc',
    pets: [
      { id: 'bunny', name: 'Bunny', bonus: 0.05, shape: 'bunny', color: '#ffffff', accent: '#ffb7d5' },
      { id: 'kitty', name: 'Kitty', bonus: 0.1, shape: 'cat', color: '#ffb35a', accent: '#ffffff' },
      { id: 'puppy', name: 'Puppy', bonus: 0.2, shape: 'dog', color: '#b07a4a', accent: '#f3dcc0' },
      { id: 'fox', name: 'Fox', bonus: 0.4, shape: 'cat', color: '#ff7a2a', accent: '#ffffff' },
      { id: 'panda', name: 'Panda', bonus: 1, shape: 'bear', color: '#ffffff', accent: '#1d1d26' },
      { id: 'unicorn', name: 'Unicorn', bonus: 2.5, shape: 'horn', color: '#ffe8ff', accent: '#ff7ad9' },
    ],
  },
  {
    id: 'jungle',
    name: 'Jungle Egg',
    price: 1800,
    rebirths: 1,
    color: '#7dd65a',
    pets: [
      { id: 'frog', name: 'Frog', bonus: 0.15, shape: 'frog', color: '#5fd14a', accent: '#ffffff' },
      { id: 'monkey', name: 'Monkey', bonus: 0.3, shape: 'bear', color: '#8a5a34', accent: '#f3dcc0' },
      { id: 'toucan', name: 'Toucan', bonus: 0.6, shape: 'bird', color: '#1d1d26', accent: '#ffb81f' },
      { id: 'tiger', name: 'Tiger', bonus: 1.2, shape: 'cat', color: '#ff9a1f', accent: '#1d1d26' },
      { id: 'gorilla', name: 'Gorilla', bonus: 3, shape: 'bear', color: '#3b3d48', accent: '#9aa3b2' },
      { id: 'dino', name: 'Dino', bonus: 7.5, shape: 'horn', color: '#3fd16b', accent: '#ffe23a' },
    ],
  },
  {
    id: 'galaxy',
    name: 'Galaxy Egg',
    price: 48_000,
    rebirths: 3,
    color: '#7a3bff',
    pets: [
      { id: 'alien', name: 'Alien', bonus: 0.45, shape: 'frog', color: '#7dffb0', accent: '#1d1d26' },
      { id: 'robot', name: 'Robot', bonus: 0.9, shape: 'robot', color: '#c3cad6', accent: '#3dfffa' },
      { id: 'comet', name: 'Comet', bonus: 1.8, shape: 'bird', color: '#3fa8ff', accent: '#ffffff' },
      { id: 'starfox', name: 'Star Fox', bonus: 3.6, shape: 'cat', color: '#b45cff', accent: '#ffd23a' },
      { id: 'nebula', name: 'Nebula Dragon', bonus: 9, shape: 'horn', color: '#5b2bd9', accent: '#ff6ef7' },
      { id: 'whale', name: 'Cosmic Whale', bonus: 22, shape: 'whale', color: '#2a3a8a', accent: '#3dfffa' },
    ],
  },
]

export const EGG_BY_ID = Object.fromEntries(EGGS.map((e) => [e.id, e]))
/** pet id -> { ...pet, egg, rarity (index), rarityId } */
export const PET_BY_ID = Object.fromEntries(
  EGGS.flatMap((egg) => egg.pets.map((pet, rarity) => [pet.id, { ...pet, egg: egg.id, rarity, rarityId: RARITIES[rarity].id }])),
)

export const eggOpen = (player, egg) => (player?.rebirths ?? 0) >= egg.rebirths

/** Chance of each rarity (0..1) with `luck` levels of the Egg Luck perk. */
export function rarityOdds(luck = 0) {
  const weights = RARITIES.map((r, i) => r.weight * (1 + SHOP_PERKS.luck.per * luck) ** Math.max(0, i - 1))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => w / total)
}

/** Which pet an egg hatches, for a random number in [0, 1). */
export function hatch(eggId, luck, random) {
  const egg = EGG_BY_ID[eggId]
  const odds = rarityOdds(luck)
  let roll = random
  for (let i = 0; i < odds.length; i += 1) {
    roll -= odds[i]
    if (roll < 0) return egg.pets[i].id
  }
  return egg.pets[0].id
}

export const petSlots = (player) => CONFIG.petSlots + perkLevel(player, 'slots')

/** The pets a player owns / has equipped (pet ids; duplicates allowed). */
export const parsePets = (csv) => (csv ? String(csv).split(',').filter((id) => PET_BY_ID[id]) : [])

/** The best `slots` pets of a list. */
export function bestPets(list, slots) {
  return [...list].sort((a, b) => PET_BY_ID[b].bonus - PET_BY_ID[a].bonus).slice(0, slots)
}

/** 1 + the bonus of every equipped pet. */
export function petsMult(player) {
  return 1 + parsePets(player?.petsEquipped).reduce((sum, id) => sum + PET_BY_ID[id].bonus, 0)
}

/* ---------------------------------------------------------------------------
 * Titles: from lifetime levels (never reset).
 * ------------------------------------------------------------------------- */

export const TITLES = [
  { at: 0, name: 'Brokie', color: '#c3cad6' },
  { at: 8, name: 'Newbie', color: '#9fe3ff' },
  { at: 20, name: 'Hopper', color: '#7dff8a' },
  { at: 40, name: 'Jumper', color: '#5fd14a' },
  { at: 70, name: 'Leaper', color: '#3fa8ff' },
  { at: 110, name: 'Sky Jumper', color: '#2f6bff' },
  { at: 160, name: 'High Flyer', color: '#b45cff' },
  { at: 230, name: 'Champion', color: '#ff7ad9' },
  { at: 320, name: 'Superstar', color: '#ffb81f' },
  { at: 450, name: 'Legend', color: '#ff3f6c' },
]

export function titleIndex(lifetimeLevels = 0) {
  let index = 0
  TITLES.forEach((t, i) => {
    if (lifetimeLevels >= t.at) index = i
  })
  return index
}

export const titleFor = (lifetimeLevels) => TITLES[titleIndex(lifetimeLevels)]

/* ---------------------------------------------------------------------------
 * XP per jump, and Wins
 * ------------------------------------------------------------------------- */

/**
 * Every multiplier on one step's or jump's XP, split out for the HUD:
 *   XP = 1 × rebirth × boots × pets × shop × boost
 * where boost = the 2x XP pass × a 2x timed boost. (Lucky ones are rolled
 * on the server.) `ctx` = { now }.
 */
export function gainBreakdown(player, { now = Date.now() } = {}) {
  const rebirth = rebirthMult(player?.rebirths ?? 0)
  const boots = BOOT_BY_ID[player?.boot]?.mult ?? 1
  const pets = petsMult(player)
  const shop = 1 + SHOP_PERKS.gain.per * perkLevel(player, 'gain')
  const pass = player?.pass2xJump ? 2 : 1
  const timed = (player?.boostUntil ?? 0) > now ? 2 : 1
  const boost = pass * timed
  const total = rebirth * boots * pets * shop * boost
  return { rebirth, boots, pets, shop, pass, timed, boost, total }
}

/** XP one step or jump pays (before luck). */
export const xpPerJump = (player, ctx) => gainBreakdown(player, ctx).total

/** Wins multiplier: +50% a rebirth, and the Winner perk. */
export const winsMult = (player) => (1 + CONFIG.rebirthWins * (player?.rebirths ?? 0)) * (1 + SHOP_PERKS.wins.per * perkLevel(player, 'wins'))

/**
 * Adds `amount` XP to (level, xp), up to MAX level. Pure: returns the new
 * { level, xp, gained } (levels gained).
 */
export function applyXp(level, xp, amount, rebirths) {
  const max = maxLevel(rebirths)
  let l = level
  let x = xp + Math.max(0, amount)
  let guard = 0
  while (l < max && x >= xpToNext(l, rebirths) && guard < 500) {
    x -= xpToNext(l, rebirths)
    l += 1
    guard += 1
  }
  if (l >= max) x = 0
  return { level: l, xp: Math.round(x * 100) / 100, gained: l - level }
}

/* ---------------------------------------------------------------------------
 * Stages: what each one needs and what it pays. Stage `index` is 1-based.
 * Every stage needs a number of jumps — every gap in it, the long jump in
 * first, is built so that one jump fewer, or the boots before, can't make it
 * (see layout.js) — and the boots whose door is at its start. Levels give up
 * to five jumps, so World 2 also needs rebirths (+1 jump each, and its doors
 * check them). Each pair of boots opens two stages: in World 1 the first is
 * about the new speed and the second about one more jump; in World 2 every
 * rebirth opens two stages, one at level 12 and one at 15.
 * ------------------------------------------------------------------------- */

export const STAGE_TABLE = [
  { jumps: 1, boot: 'starter', rebirths: 0, wins: 3 },
  { jumps: 2, boot: 'starter', rebirths: 0, wins: 5 },
  { jumps: 2, boot: 'sneakers', rebirths: 0, wins: 8 },
  { jumps: 3, boot: 'sneakers', rebirths: 0, wins: 12 },
  { jumps: 3, boot: 'bouncy', rebirths: 0, wins: 18 },
  { jumps: 4, boot: 'bouncy', rebirths: 0, wins: 25 },
  { jumps: 4, boot: 'rocket', rebirths: 0, wins: 35 },
  { jumps: 5, boot: 'rocket', rebirths: 0, wins: 46 },
  { jumps: 5, boot: 'lava', rebirths: 0, wins: 62 },
  { jumps: 5, boot: 'lava', rebirths: 0, wins: 83 },
  { jumps: 5, boot: 'frost', rebirths: 1, wins: 90 },
  { jumps: 6, boot: 'frost', rebirths: 1, wins: 125 },
  { jumps: 6, boot: 'thunder', rebirths: 2, wins: 180 },
  { jumps: 7, boot: 'thunder', rebirths: 2, wins: 250 },
  { jumps: 7, boot: 'galaxy', rebirths: 3, wins: 350 },
  { jumps: 8, boot: 'galaxy', rebirths: 3, wins: 480 },
  { jumps: 8, boot: 'rainbow', rebirths: 4, wins: 650 },
  { jumps: 9, boot: 'rainbow', rebirths: 4, wins: 880 },
  { jumps: 9, boot: 'diamond', rebirths: 5, wins: 1200 },
  { jumps: 10, boot: 'diamond', rebirths: 5, wins: 1700 },
].map((row) => ({ ...row, level: levelForJumps(row.jumps, row.rebirths) }))

/** The stages each pair of boots opens: [first, last] (1-based), or null. */
for (const boot of BOOTS) {
  const indices = STAGE_TABLE.map((s, i) => (s.boot === boot.id ? i + 1 : 0)).filter(Boolean)
  boot.stages = indices.length ? [indices[0], indices[indices.length - 1]] : null
}

/** What stage `index` needs: { jumps, level, boot, bootTier, rebirths }. */
export function stageNeeds(index) {
  const row = STAGE_TABLE[index - 1] ?? STAGE_TABLE[0]
  return { jumps: row.jumps, level: row.level, boot: row.boot, bootTier: bootTier(row.boot), rebirths: row.rebirths }
}

/** Can a player get into stage `index` (its boots and rebirths; the jumps are up to them)? */
export function stageOpen(player, index) {
  const need = stageNeeds(index)
  return (player?.rebirths ?? 0) >= need.rebirths && bestBootTier(player) >= need.bootTier
}

/** Wins for finishing stage `index` (doubled on the 2x pad). */
export function stageWins(index, player, double = false) {
  const base = STAGE_TABLE[index - 1]?.wins ?? 1
  return Math.max(1, Math.round(base * winsMult(player) * (double ? 2 : 1)))
}

/** A "unit" of Wins that grows with how far you've got (gifts, chest, daily, prices of XP packs). */
export function winsUnit(player) {
  const best = Math.max(0, Math.min(STAGE_TABLE.length, player?.bestStage ?? 0))
  const base = best ? STAGE_TABLE[best - 1].wins : 2
  return Math.max(1, Math.round(base * 0.5 * (1 + CONFIG.rebirthWins * (player?.rebirths ?? 0))))
}

/** The lowest level that can make stage `index` (the first with its jumps). */
export const stageLevel = (index) => STAGE_TABLE[index - 1]?.level ?? 0

/* ---------------------------------------------------------------------------
 * XP packs, passes, codes, gifts, daily and chest
 * ------------------------------------------------------------------------- */

/** XP-earning actions a second this player trains at: their best jump pad, or running and jumping. */
export const trainingRate = (player) => Math.max(bestPadRate(player), CONFIG.handJumpRate + stepsPerSecond(player?.boot ?? 'starter', player?.perkSpeed ?? 0) * 0.5)

/** XP worth `minutes` of training at your best rate, with your multipliers. */
export function minutesOfXp(player, minutes) {
  return Math.round(minutes * 60 * trainingRate(player) * gainBreakdown(player, { now: 0 }).total)
}

/** Bought with Wins. Packs give minutes of XP, priced in Wins units. */
export const PRODUCTS = {
  pass2xJump: { name: '2x XP', price: 150 },
  pass2xWins: { name: '2x Wins', price: 400 },
  xp5: { name: '+5 min XP', minutes: 5, units: 2 },
  xp30: { name: '+30 min XP', minutes: 30, units: 9 },
  xp2h: { name: '+2 h XP', minutes: 120, units: 30 },
  xp8h: { name: '+8 h XP', minutes: 480, units: 100 },
}

export const XP_PACKS = ['xp5', 'xp30', 'xp2h', 'xp8h']

/** What a product costs this player (packs scale with your Wins unit). */
export const productPrice = (id, player) => (PRODUCTS[id].units ? PRODUCTS[id].units * winsUnit(player) : PRODUCTS[id].price)

/** Playtime gifts (per session): wins = × your Wins unit; boost = 2x minutes; xp = minutes of XP. */
export const GIFTS = [
  { minutes: 1, kind: 'wins', amount: 1 },
  { minutes: 3, kind: 'boost', amount: 5 },
  { minutes: 6, kind: 'wins', amount: 2 },
  { minutes: 10, kind: 'xp', amount: 5 },
  { minutes: 15, kind: 'wins', amount: 4 },
  { minutes: 20, kind: 'boost', amount: 10 },
  { minutes: 30, kind: 'wins', amount: 8 },
  { minutes: 45, kind: 'xp', amount: 15 },
]

export const CHEST_COOLDOWN_MS = 15 * 60_000
/** The daily reward refills after 20 h; missing it for over 48 h breaks the streak. */
export const DAILY_COOLDOWN_MS = 20 * 60 * 60_000
export const DAILY_STREAK_WINDOW_MS = 48 * 60 * 60_000
export const DAILY_MAX_STREAK = 7

/** What a reward spec is worth to this player now: { wins?, xp?, boost? }. */
export function resolveReward(spec, player) {
  const out = {}
  if (spec.wins) out.wins = spec.wins
  if (spec.winsUnits) out.wins = spec.winsUnits * winsUnit(player)
  if (spec.xpMinutes) out.xp = minutesOfXp(player, spec.xpMinutes)
  if (spec.boost) out.boost = spec.boost
  return out
}

export function giftReward(gift, player) {
  if (gift.kind === 'wins') return resolveReward({ winsUnits: gift.amount }, player)
  if (gift.kind === 'boost') return { boost: gift.amount }
  return resolveReward({ xpMinutes: gift.amount }, player)
}

export const dailyReward = (player, streak) => ({ wins: (2 + Math.min(streak, DAILY_MAX_STREAK)) * winsUnit(player) })
export const chestReward = (player) => ({ wins: 2 * winsUnit(player) })

/** Offline earnings for `seconds` away: 30% of the best jump pad's rate, up to 8 h. */
export function offlineEarnings(player, seconds) {
  const time = Math.min(CONFIG.offlineMaxSeconds, Math.max(0, seconds))
  if (time < CONFIG.offlineMinSeconds) return null
  const jumps = Math.floor(bestPadRate(player) * CONFIG.offlineShare * time)
  if (jumps <= 0) return null
  return { seconds: Math.round(time), jumps, xp: Math.round(jumps * gainBreakdown(player, { now: 0 }).total) }
}

/* ---------------------------------------------------------------------------
 * The one goal to show, and the one thing worth a red "!"
 * ------------------------------------------------------------------------- */

/**
 * The next goal, the one thing worth doing next: the next stage when you can
 * beat it; else rebirth when you're at level 15; else the boots the next
 * stage needs (with your Wins towards them); else the level that gives the
 * next stage its jumps (or, if no level can this rebirth, MAX to rebirth for
 * +1 jump); else the next title. { kind, text, value, target }.
 */
export function nextGoal(player) {
  if (!player) return null
  const level = player.level ?? 0
  const rebirths = player.rebirths ?? 0
  const max = maxLevel()
  const best = player.bestStage ?? 0
  const next = STAGE_TABLE[best]
  const index = best + 1
  const jumps = jumpsFor(level, rebirths)
  const open = next && stageOpen(player, index)
  if (open && jumps >= next.jumps) return { kind: 'stage', text: `BEAT STAGE ${index}!`, value: best, target: index }
  if (canRebirth(player)) return { kind: 'rebirth', text: 'REBIRTH FOR +1 JUMP!', value: level, target: max }
  if (next && rebirths >= next.rebirths && !open) {
    const boot = BOOT_BY_ID[next.boot]
    return { kind: 'boots', text: `BUY ${boot.name.toUpperCase()} FOR STAGE ${index}!`, value: Math.min(player.wins ?? 0, boot.price), target: boot.price, boot: boot.id }
  }
  if (next && jumps < next.jumps) {
    const target = levelForJumps(next.jumps, rebirths)
    if (target <= max) return { kind: 'level', text: `REACH LEVEL ${target} FOR ${next.jumps} JUMPS!`, value: level, target }
    return { kind: 'level', text: `REACH LEVEL ${max} AND REBIRTH FOR ${next.jumps} JUMPS!`, value: level, target: max }
  }
  if (level < max) {
    const target = nextJumpLevel(level) ?? max
    return { kind: 'level', text: target === max ? `REACH LEVEL ${max} TO REBIRTH!` : `REACH LEVEL ${target} FOR ${jumpsFor(target, rebirths)} JUMPS!`, value: level, target }
  }
  const t = titleIndex(player.lifetimeLevels ?? 0)
  const title = TITLES[t + 1]
  if (title) return { kind: 'title', text: `BECOME A ${title.name.toUpperCase()}!`, value: player.lifetimeLevels ?? 0, target: title.at }
  return { kind: 'done', text: 'YOU ARE A LEGEND!', value: 1, target: 1 }
}

/** The next boots tier to buy (after the best you own), or null. */
export function nextBoot(player) {
  return BOOTS[bestBootTier(player) + 1] ?? null
}

/**
 * The single most important thing you can afford right now (for the red
 * "!"): 'rebirth' | 'boots' | 'shop' | 'pets' | null.
 */
export function mostImportant(player, { hydraLeft = 1 } = {}) {
  if (!player) return null
  if (canRebirth(player)) return 'rebirth'
  const boot = nextBoot(player)
  if (boot && player.wins >= boot.price && (!boot.limited || hydraLeft > 0)) return 'boots'
  for (const id of Object.keys(SHOP_PERKS)) {
    const level = perkLevel(player, id)
    if (level < SHOP_PERKS[id].max && player.wins >= perkPrice(id, level)) return 'shop'
  }
  const pets = parsePets(player.pets)
  if (pets.length < CONFIG.petInventory && EGGS.some((egg) => eggOpen(player, egg) && player.wins >= egg.price)) return 'pets'
  return null
}

/* ---------------------------------------------------------------------------
 * Saves
 * ------------------------------------------------------------------------- */

const clampInt = (value, lo, hi, fallback = lo) => (Number.isFinite(value) ? Math.max(lo, Math.min(hi, Math.floor(value))) : fallback)

/** Wins spent on `levels` levels of something priced base × growth^level (refunds). */
const spentOn = (levels, base, growth) => {
  let sum = 0
  for (let i = 0; i < levels; i += 1) sum += Math.round(base * growth ** i)
  return sum
}

/**
 * Brings a saved profile up to SAVE_VERSION, then clamps every number.
 *  v1 (no version): levels 1-15 that never grew, trampolines, scripted goals.
 *    Wins, rebirths, boots, stages, stars, trails and passes carry over; the
 *    level maps onto the new curve (old level 1 = new level 0) with no XP.
 *  v2: XP from walking, a step boost pad, the Fast Learner perk and Spring
 *    Boots. All three are gone: the Wins they cost are paid back (and Spring
 *    Boots owners keep every other pair).
 *  v4: the Super and Turbo Pads came with rebirths 1 and 2; now they're bought
 *    with Wins, so players who had them keep them.
 */
export function migrateProfile(profile) {
  if (!profile) return null
  const p = { ...profile }
  if (!p.saveVersion || p.saveVersion < 2) {
    const rebirths = clampInt(p.rebirths, 0, 1e6, 0)
    p.rebirths = rebirths
    p.level = Math.min(clampInt(p.level, 1, 15, 1) - 1, maxLevel(rebirths))
    p.xp = 0
    p.lifetimeLevels = rebirths * CONFIG.maxLevel + p.level
    p.stepBoost = 0
    p.perkXp = 0
    for (const field of Object.values(PERK_FIELDS)) p[field] = 0
    p.pets = ''
    p.petsEquipped = ''
    delete p.tramps
    delete p.goal
    delete p.goalTarget
    p.saveVersion = 2
  }
  if (p.saveVersion < 3) {
    let refund = spentOn(clampInt(p.stepBoost, 0, 10_000, 0), 8, 1.15) + spentOn(clampInt(p.perkXp, 0, 10, 0), 60, 2.1)
    const owned = csvList(p.bootsOwned)
    if (owned.includes('spring')) {
      refund += 120
      p.bootsOwned = owned.filter((id) => id !== 'spring').join(',')
    }
    if (p.boot === 'spring') p.boot = 'bouncy'
    p.wins = (Number.isFinite(p.wins) ? p.wins : 0) + refund
    delete p.stepBoost
    delete p.perkXp
    p.saveVersion = 3
  }
  if (p.saveVersion < 4) {
    // MAX is 15 for everyone now (rebirths give jumps instead of levels); codes are gone.
    p.level = Math.min(clampInt(p.level, 0, 1e6, 0), CONFIG.maxLevel)
    p.xp = 0
    delete p.codes
    p.saveVersion = 4
  }
  if (p.saveVersion < 5) {
    const rebirths = clampInt(p.rebirths, 0, 1e6, 0)
    const pads = new Set(csvList(p.padsOwned))
    if (rebirths >= 1) pads.add('pad2')
    if (rebirths >= 2) pads.add('pad3')
    p.padsOwned = [...pads].join(',')
    p.saveVersion = 5
  }
  // Whatever the version, keep every number in range.
  p.rebirths = clampInt(p.rebirths, 0, 1e6, 0)
  p.level = clampInt(p.level, 0, maxLevel(), 0)
  p.xp = Number.isFinite(p.xp) ? Math.max(0, p.xp) : 0
  p.wins = Number.isFinite(p.wins) ? Math.max(0, p.wins) : 0
  for (const [id, field] of Object.entries(PERK_FIELDS)) p[field] = clampInt(p[field], 0, SHOP_PERKS[id].max, 0)
  p.lifetimeLevels = clampInt(p.lifetimeLevels, p.level, 1e9, p.level)
  // Owned boots are a run from the slippers up (bought in order); wear one you own.
  const owned = new Set(csvList(p.bootsOwned).filter((id) => BOOT_BY_ID[id]))
  owned.add('starter')
  p.bootsOwned = BOOTS.filter((b) => owned.has(b.id)).map((b) => b.id).join(',')
  if (!owned.has(p.boot)) p.boot = 'starter'
  p.padsOwned = csvList(p.padsOwned).filter((id) => PAD_BY_ID[id]?.price).join(',')
  return p
}

/* ---------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------- */

function round1(n) {
  return Math.round(n * 10) / 10
}

/** 2 -> "x2", 1.5 -> "x1.5", 12345 -> "x12.3K". */
export function formatMult(n) {
  if (n < 1000) return `x${parseFloat(n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0))}`
  const units = ['K', 'M', 'B', 'T', 'Qa']
  let v = n
  let u = -1
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u += 1
  }
  return `x${parseFloat(v.toFixed(v >= 100 ? 0 : 1))}${units[u]}`
}

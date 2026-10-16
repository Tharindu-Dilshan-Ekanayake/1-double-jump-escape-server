import {
  BOOTS,
  BOOT_BY_ID,
  CHEST_COOLDOWN_MS,
  CONFIG,
  DAILY_COOLDOWN_MS,
  DAILY_MAX_STREAK,
  DAILY_STREAK_WINDOW_MS,
  EGG_BY_ID,
  GIFTS,
  PAD_BY_ID,
  PERK_FIELDS,
  PET_BY_ID,
  PRODUCTS,
  REBIRTH_RESETS,
  SHOP_PERKS,
  TRAIL_BY_ID,
  trailOpen,
  applyXp,
  bestPets,
  canRebirth,
  chestReward,
  dailyReward,
  eggOpen,
  giftReward,
  hatch,
  jumpsFor,
  maxLevel,
  minutesOfXp,
  moveStats,
  parseList,
  parsePets,
  perkLevel,
  perkPrice,
  petSlots,
  productPrice,
  rebirthMult,
  titleIndex,
} from '../shared/gameData.js'

/**
 * Every server-side action that changes a player's stats, applying the rules
 * in shared/progression.js.
 *
 * Each function mutates the PlayerState (so Colyseus syncs the change) and returns
 * `{ ok: true, code, ... }` or `{ ok: false, code }`. Codes are machine words the
 * client turns into its own UI — the server never sends text to show.
 * `session` holds the parsed counters for that connection.
 */

const round2 = (n) => Math.round(n * 100) / 100
const fail = (code, extra = {}) => ({ ok: false, code, ...extra })

export function readJSON(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : fallback
  } catch {
    return fallback
  }
}

/**
 * Adds XP (a jump's worth, or a reward's) to the level bar (up to MAX) and to
 * the lifetime total. Returns what a level up changed, or null.
 */
export function addXp(player, xp) {
  if (!(xp > 0)) return null
  const from = player.level
  player.totalJump = round2(player.totalJump + xp)
  const next = applyXp(player.level, player.xp, xp, player.rebirths)
  player.level = next.level
  player.xp = next.xp
  if (!next.gained) return null
  const fromTitle = titleIndex(player.lifetimeLevels)
  player.lifetimeLevels += next.gained
  const before = moveStats(from, player.boot, player.perkSpeed, player.rebirths)
  const after = moveStats(player.level, player.boot, player.perkSpeed, player.rebirths)
  return {
    from,
    to: player.level,
    max: maxLevel(player.rebirths),
    jumpsFrom: before.jumps,
    jumpsTo: after.jumps,
    speedFrom: before.speed,
    speedTo: after.speed,
    title: titleIndex(player.lifetimeLevels) > fromTitle ? titleIndex(player.lifetimeLevels) : null,
  }
}

export function bumpCounter(player, session, key, amount = 1) {
  session.counters[key] = round2((session.counters[key] || 0) + amount)
  player.counters = JSON.stringify(session.counters)
}

/** Pays a reward ({ wins, xp, boost }); returns a level-up if the XP caused one. */
export function grant(player, session, reward, now = Date.now()) {
  if (reward.wins) {
    player.wins += reward.wins
    bumpCounter(player, session, 'wins', reward.wins)
  }
  if (reward.boost) player.boostUntil = Math.max(player.boostUntil, now) + reward.boost * 60_000
  if (reward.xp) return addXp(player, reward.xp)
  return null
}

const owns = (csv, id) => parseList(csv).includes(id)
const addTo = (csv, id) => (owns(csv, id) ? csv : [...parseList(csv), id].join(','))

function spend(player, amount) {
  if (player.wins < amount) return false
  player.wins -= amount
  return true
}

/** Equips the best pets that fit the slots. */
export function equipBestPets(player) {
  player.petsEquipped = bestPets(parsePets(player.pets), petSlots(player)).join(',')
}

/* ---------------------------------------------------------------------------
 * Buying and equipping
 * ------------------------------------------------------------------------- */

/**
 * `limited` is { left(id, stock), reserve(id, stock), release(id) } (the global
 * stock in the profile store). Resolves the result (limited items are async).
 */
export async function buy(player, { cat, id } = {}, limited) {
  if (cat === 'boot') {
    const def = BOOT_BY_ID[id]
    if (!def) return fail('unknown')
    if (owns(player.bootsOwned, id)) {
      player.boot = id
      return { ok: true, code: 'equipped', cat, id }
    }
    // Boots are bought in order: the tier before this one first.
    const index = BOOTS.indexOf(def)
    if (index > 0 && !owns(player.bootsOwned, BOOTS[index - 1].id)) return fail('order', { need: BOOTS[index - 1].id })
    if (player.wins < def.price) return fail('poor', { need: def.price - player.wins })
    if (def.limited) {
      if (limited.left(id, def.limited) <= 0) return fail('soldout')
      if (!(await limited.reserve(id, def.limited))) return fail('soldout')
      // The player might have spent their Wins while we waited.
      if (!spend(player, def.price)) {
        await limited.release(id)
        return fail('poor', { need: def.price - player.wins })
      }
    } else {
      spend(player, def.price)
    }
    player.bootsOwned = addTo(player.bootsOwned, id)
    player.boot = id
    return { ok: true, code: 'bought', cat, id }
  }

  if (cat === 'pad') {
    // The jump pads sold for Wins: bought once, kept for good (rebirths too).
    const def = PAD_BY_ID[id]
    if (!def?.price) return fail('unknown')
    if (owns(player.padsOwned, id)) return fail('owned')
    if ((player.rebirths ?? 0) < def.rebirths) return fail('locked', { need: def.rebirths })
    if (!spend(player, def.price)) return fail('poor', { need: def.price - player.wins })
    player.padsOwned = addTo(player.padsOwned, id)
    return { ok: true, code: 'bought', cat, id }
  }

  if (cat === 'perk') {
    const perk = SHOP_PERKS[id]
    if (!perk) return fail('unknown')
    const level = perkLevel(player, id)
    if (level >= perk.max) return fail('maxed')
    const price = perkPrice(id, level)
    if (!spend(player, price)) return fail('poor', { need: price - player.wins })
    player[PERK_FIELDS[id]] = level + 1
    if (id === 'slots') equipBestPets(player)
    return { ok: true, code: 'bought', cat, id, level: level + 1 }
  }

  if (cat === 'egg') {
    const egg = EGG_BY_ID[id]
    if (!egg) return fail('unknown')
    if (!eggOpen(player, egg)) return fail('locked', { need: egg.rebirths })
    if (parsePets(player.pets).length >= CONFIG.petInventory) return fail('full')
    if (!spend(player, egg.price)) return fail('poor', { need: egg.price - player.wins })
    const pet = hatch(id, perkLevel(player, 'luck'), Math.random())
    player.pets = [...parsePets(player.pets), pet].join(',')
    equipBestPets(player)
    return { ok: true, code: 'hatched', cat, id, pet }
  }

  if (cat === 'trail') {
    const def = TRAIL_BY_ID[id]
    if (!def) return fail('unknown')
    if (owns(player.trailsOwned, id)) {
      player.trail = id
      return { ok: true, code: 'equipped', cat, id }
    }
    if (!trailOpen(player, def)) return fail('locked', { stage: def.stage })
    if (!spend(player, def.price)) return fail('poor', { need: def.price - player.wins })
    player.trailsOwned = addTo(player.trailsOwned, id)
    player.trail = id
    return { ok: true, code: 'bought', cat, id }
  }

  if (cat === 'product') {
    const product = PRODUCTS[id]
    if (!product) return fail('unknown')
    const pass = id === 'pass2xJump' || id === 'pass2xWins'
    if (pass && player[id]) return fail('owned')
    const price = productPrice(id, player)
    if (!spend(player, price)) return fail('poor', { need: price - player.wins })
    if (pass) {
      player[id] = true
      return { ok: true, code: 'bought', cat, id }
    }
    const xp = minutesOfXp(player, product.minutes)
    const levelUp = addXp(player, xp)
    return { ok: true, code: 'bought', cat, id, levelUp, reward: { xp } }
  }

  return fail('unknown')
}

export function equip(player, { cat, id } = {}) {
  if (cat === 'boot' && BOOT_BY_ID[id] && owns(player.bootsOwned, id)) {
    player.boot = id
    return { ok: true, code: 'equipped', cat, id }
  }
  if (cat === 'trail' && TRAIL_BY_ID[id] && owns(player.trailsOwned, id)) {
    player.trail = id
    return { ok: true, code: 'equipped', cat, id }
  }
  return fail('notOwned')
}

/**
 * Pets: `op` is 'equip' | 'unequip' | 'delete' (one pet of type `id`) or
 * 'best' (equip the best that fit).
 */
export function pets(player, { op, id } = {}) {
  const owned = parsePets(player.pets)
  const equipped = parsePets(player.petsEquipped)
  if (op === 'best') {
    equipBestPets(player)
    return { ok: true, code: 'pets' }
  }
  if (!PET_BY_ID[id]) return fail('unknown')
  const count = (list) => list.filter((p) => p === id).length
  if (op === 'equip') {
    if (count(owned) <= count(equipped)) return fail('notOwned')
    if (equipped.length >= petSlots(player)) return fail('slots')
    player.petsEquipped = [...equipped, id].join(',')
    return { ok: true, code: 'pets' }
  }
  if (op === 'unequip') {
    const i = equipped.indexOf(id)
    if (i < 0) return fail('notOwned')
    equipped.splice(i, 1)
    player.petsEquipped = equipped.join(',')
    return { ok: true, code: 'pets' }
  }
  if (op === 'delete') {
    const i = owned.indexOf(id)
    if (i < 0) return fail('notOwned')
    owned.splice(i, 1)
    player.pets = owned.join(',')
    // Can't keep more of a pet equipped than you own.
    while (count(equipped) > count(owned)) equipped.splice(equipped.indexOf(id), 1)
    player.petsEquipped = equipped.join(',')
    return { ok: true, code: 'pets' }
  }
  return fail('unknown')
}

/* ---------------------------------------------------------------------------
 * Rebirth
 * ------------------------------------------------------------------------- */

/** At level 15: level and XP go back to zero; +1 jump, ×2 XP and more Wins for good. */
export function rebirth(player) {
  if (!canRebirth(player)) return fail('notReady')
  player.rebirths += 1
  Object.assign(player, REBIRTH_RESETS)
  return { ok: true, code: 'rebirth', rebirths: player.rebirths, mult: rebirthMult(player.rebirths), jumps: jumpsFor(0, player.rebirths), max: maxLevel() }
}

/* ---------------------------------------------------------------------------
 * Rewards: daily, chest, playtime gifts
 * ------------------------------------------------------------------------- */

/** The daily reward, collected automatically on the first join of the day. */
export function claimDaily(player, session, now = Date.now()) {
  if (now < player.dailyAt) return null
  const lastClaim = player.dailyAt - DAILY_COOLDOWN_MS
  const keepsStreak = player.dailyAt > 0 && now - lastClaim < DAILY_STREAK_WINDOW_MS
  player.dailyStreak = keepsStreak ? Math.min(DAILY_MAX_STREAK, player.dailyStreak + 1) : 1
  const reward = dailyReward(player, player.dailyStreak)
  player.dailyAt = now + DAILY_COOLDOWN_MS
  grant(player, session, reward, now)
  return { streak: player.dailyStreak, reward }
}

export function claimChest(player, session, now = Date.now()) {
  if (now < player.chestAt) return fail('cooldown', { at: player.chestAt })
  const reward = chestReward(player)
  player.chestAt = now + CHEST_COOLDOWN_MS
  const levelUp = grant(player, session, reward, now)
  return { ok: true, code: 'claimed', what: 'chest', reward, levelUp }
}

export function claimGift(player, session, index, now = Date.now()) {
  const gift = GIFTS[index]
  if (!gift) return fail('unknown')
  const claimed = parseList(player.gifts)
  if (claimed.includes(String(index))) return fail('claimed')
  if (now - player.sessionAt < gift.minutes * 60_000 - 1500) return fail('notReady')
  const reward = giftReward(gift, player)
  player.gifts = [...claimed, String(index)].join(',')
  const levelUp = grant(player, session, reward, now)
  return { ok: true, code: 'claimed', what: 'gift', index, reward, levelUp }
}

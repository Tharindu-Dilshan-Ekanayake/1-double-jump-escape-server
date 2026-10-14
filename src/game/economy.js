import {
  BOOT_BY_ID,
  CHEST_COOLDOWN_MS,
  CODES,
  DAILY_COOLDOWN_MS,
  DAILY_MAX_STREAK,
  DAILY_STREAK_WINDOW_MS,
  GIFTS,
  MAX_LEVEL,
  PRODUCTS,
  SCRIPTED_GOAL_COUNT,
  TRAIL_BY_ID,
  TRAMPOLINE_BY_ID,
  canRebirth,
  chestReward,
  dailyReward,
  giftReward,
  goalAt,
  goalValue,
  jumpsFor,
  moveStats,
  parseList,
  xpForLevel,
} from '../shared/gameData.js'

/**
 * Every server-side action that changes a player's stats.
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

/** Adds Jump: always to the total (leaderboards), and to XP until MAX level. */
export function addJump(player, amount) {
  const from = player.level
  player.totalJump = round2(player.totalJump + amount)
  if (player.level < MAX_LEVEL) {
    player.xp = round2(player.xp + amount)
    let guard = 0
    while (player.level < MAX_LEVEL && player.xp >= xpForLevel(player.level, player.rebirths) && guard < 100) {
      player.xp = round2(player.xp - xpForLevel(player.level, player.rebirths))
      player.level += 1
      guard += 1
    }
    if (player.level >= MAX_LEVEL) player.xp = 0
  }
  if (player.level === from) return null
  const before = moveStats(from, player.boot, player.rebirths)
  const after = moveStats(player.level, player.boot, player.rebirths)
  return {
    from,
    to: player.level,
    jumpsFrom: jumpsFor(from),
    jumpsTo: after.jumps,
    speedFrom: before.speed,
    speedTo: after.speed,
    heightFrom: before.height,
    heightTo: after.height,
  }
}

export function bumpCounter(player, session, key, amount = 1) {
  session.counters[key] = round2((session.counters[key] || 0) + amount)
  player.counters = JSON.stringify(session.counters)
}

/** Pays a reward ({ wins, jump, boost }); returns a level-up if the Jump caused one. */
export function grant(player, session, reward, now = Date.now()) {
  if (reward.wins) {
    player.wins += reward.wins
    bumpCounter(player, session, 'wins', reward.wins)
  }
  if (reward.boost) player.boostUntil = Math.max(player.boostUntil, now) + reward.boost * 60_000
  if (reward.jump) return addJump(player, reward.jump)
  return null
}

const owns = (csv, id) => parseList(csv).includes(id)
const addTo = (csv, id) => (owns(csv, id) ? csv : [...parseList(csv), id].join(','))

function spend(player, amount) {
  if (player.wins < amount) return false
  player.wins -= amount
  return true
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

  if (cat === 'tramp') {
    const def = TRAMPOLINE_BY_ID[id]
    if (!def) return fail('unknown')
    if (def.price === 0 || owns(player.tramps, id)) return fail('owned')
    if (!spend(player, def.price)) return fail('poor', { need: def.price - player.wins })
    player.tramps = addTo(player.tramps, id)
    return { ok: true, code: 'bought', cat, id }
  }

  if (cat === 'trail') {
    const def = TRAIL_BY_ID[id]
    if (!def) return fail('unknown')
    if (owns(player.trailsOwned, id)) {
      player.trail = id
      return { ok: true, code: 'equipped', cat, id }
    }
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
    if (!spend(player, product.price)) return fail('poor', { need: product.price - player.wins })
    if (pass) {
      player[id] = true
      return { ok: true, code: 'bought', cat, id }
    }
    const levelUp = addJump(player, product.jump)
    return { ok: true, code: 'bought', cat, id, levelUp, reward: { jump: product.jump } }
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

/* ---------------------------------------------------------------------------
 * Rebirth
 * ------------------------------------------------------------------------- */

export function rebirth(player) {
  if (!canRebirth(player)) return fail('notReady')
  player.rebirths += 1
  player.level = 1
  player.xp = 0
  return { ok: true, code: 'rebirth', rebirths: player.rebirths }
}

/* ---------------------------------------------------------------------------
 * Rewards: daily, chest, playtime gifts, codes
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

export function redeemCode(player, session, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase().slice(0, 32)
  const reward = CODES[code]
  if (!reward) return fail('badCode')
  if (session.codes.includes(code)) return fail('usedCode')
  session.codes.push(code)
  const levelUp = grant(player, session, reward)
  return { ok: true, code: 'redeemed', reward, levelUp }
}

/* ---------------------------------------------------------------------------
 * Goals (the banner at the top)
 * ------------------------------------------------------------------------- */

/**
 * Pays out the current goal once it's done and moves on to the next.
 * Returns `{ reward, levelUp, index }` when a goal completed, else null.
 */
export function checkGoal(player, session) {
  const goal = goalAt(player.goal, player, session.counters, player.goalTarget)
  if (goalValue(goal.kind, player, session.counters) < goal.target) {
    // An endless goal stores its target the first time it's seen.
    if (goal.endless && !player.goalTarget) player.goalTarget = goal.target
    return null
  }
  const levelUp = grant(player, session, goal.reward)
  player.goal += 1
  player.goalTarget = player.goal >= SCRIPTED_GOAL_COUNT ? goalAt(player.goal, player, session.counters, 0).target : 0
  return { reward: goal.reward, levelUp, index: goal.index }
}

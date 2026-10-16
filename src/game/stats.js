import { bareUserId } from './identity.js'

/**
 * Reports each signed-in player's game stats to their Boxity profile (the
 * "Only in this game" section of this game's card).
 *
 * Every value is read from the server's own player state, never from a
 * client message. Only active on Boxity hosting, which provides
 * BLOXITY_REPORT_TOKEN and BLOXITY_GAME_ID; without them this does nothing
 * (local development). Playtime, sessions, streaks and Boxity's own level
 * are tracked by Boxity itself, so they are not sent.
 */

const API_URL = (process.env.BLOXITY_API_URL || 'https://api.bloxity.io').replace(/\/$/, '')
const INTERVAL_MS = 60_000
const BATCH = 200

// Boxity rejects (does not clamp) anything above these.
const CEILING = { number: 1_000_000_000, seconds: 31_536_000_000, currency: 1_000_000_000_000, percent: 100 }

const DEFINITIONS = [
  { key: 'rebirths', label: 'Rebirths', type: 'number', sortOrder: 1 },
  { key: 'best_stage', label: 'Best Stage', type: 'number', sortOrder: 2 },
  { key: 'stars', label: 'Stage Stars', type: 'number', sortOrder: 3 },
  { key: 'wins', label: 'Wins', type: 'number', sortOrder: 4 },
  { key: 'boots', label: 'Boots Owned', type: 'number', sortOrder: 5 },
  { key: 'levels_gained', label: 'Levels Gained', type: 'number', sortOrder: 6 },
]
const TYPE_OF = Object.fromEntries(DEFINITIONS.map((d) => [d.key, d.type]))

const sumDigits = (text) => [...String(text || '')].reduce((sum, ch) => sum + (Number(ch) || 0), 0)
const countList = (text) => String(text || '').split(',').filter(Boolean).length

/** The values to report for one player state, each checked: a finite, non-negative number under its ceiling. */
function valuesFor(state) {
  const raw = {
    rebirths: state.rebirths,
    best_stage: state.bestStage,
    stars: sumDigits(state.stars),
    wins: state.wins,
    boots: countList(state.bootsOwned),
    levels_gained: state.lifetimeLevels,
  }
  const values = {}
  for (const [key, v] of Object.entries(raw)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > CEILING[TYPE_OF[key]]) continue
    values[key] = Math.floor(v)
  }
  return values
}

/** Only Boxity accounts have a profile to show stats on; guests are skipped. */
const boxityUserId = (uid) => (typeof uid === 'string' && uid.startsWith('bx:') ? `legion_${bareUserId(uid.slice(3)).split('#')[0]}` : null)

async function post(url, token, players) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitions: DEFINITIONS, players }),
      signal: AbortSignal.timeout(8000),
    })
    // The only way to see why a number isn't showing up on a profile.
    console.log(`[stats] ${res.status} ${(await res.text()).slice(0, 400)}`)
  } catch (err) {
    console.warn('[stats] report failed:', err.message)
  }
}

/** Players who left since the last report, so their final values still go out. */
const departed = new Map()

/** Call when a player leaves, with their final state. */
export function rememberForStats(uid, state) {
  if (boxityUserId(uid)) departed.set(uid, valuesFor(state))
}

/**
 * Starts reporting every 60 s.
 * @param {() => Iterable<{ uid: string, state: object }>} online every player on this server right now
 * @returns {(() => Promise<void>) | null} flush (for shutdown), or null when reporting is off
 */
export function installStatReporter(online) {
  const token = process.env.BLOXITY_REPORT_TOKEN
  const gameId = process.env.BLOXITY_GAME_ID
  if (!token || !gameId) return null
  const url = `${API_URL}/v1/games/${encodeURIComponent(gameId)}/stats`

  const flush = async () => {
    try {
      const byUser = new Map()
      for (const [uid, values] of departed) byUser.set(boxityUserId(uid), values)
      departed.clear()
      for (const { uid, state } of online()) {
        const userId = boxityUserId(uid)
        if (userId) byUser.set(userId, valuesFor(state))
      }
      const players = [...byUser]
        .filter(([, values]) => Object.keys(values).length)
        .map(([userId, values]) => ({ userId, values }))
      for (let i = 0; i < players.length; i += BATCH) await post(url, token, players.slice(i, i + BATCH))
    } catch (err) {
      console.warn('[stats] flush failed:', err.message)
    }
  }

  const timer = setInterval(flush, INTERVAL_MS)
  timer.unref?.()
  console.log('[stats] reporting player stats to Boxity every 60 s')
  return flush
}

/**
 * The whole game loop, played for real against a running server: a fresh
 * player trains on the jump pad and walks (XP, levels, more jumps), runs each
 * stage they have the jumps and boots for (Wins), buys boots and a jump pad
 * with the Wins, reaches level 15 and rebirths — then checks the rebirth
 * (counter, +1 jump, x2 XP) and that the teleport only goes to stages already
 * reached. Moves are sent at the boots' real speed, so the server's run checks
 * apply exactly as they do to players. Takes ten minutes or so.
 *
 *   node scripts/loop-test.js ws://localhost:2567
 */
import { Client } from '@colyseus/sdk'

import { BOOT_BY_ID, PAD_BY_ID, ROOM_NAME, STAGE_TABLE, jumpsFor, maxLevel, playerMoveStats } from '../src/shared/gameData.js'
import { getLayout, inLobby } from '../src/shared/layout.js'

const endpoint = process.argv[2] || 'ws://localhost:2567'
const GIVE_UP_MS = 25 * 60_000
const TICK = 50
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}
const started = Date.now()
const clock = () => {
  const s = Math.round((Date.now() - started) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const log = (text) => console.log(`  [${clock()}] ${text}`)

const layout = getLayout()
const spawn = layout.spawn
const client = new Client(endpoint)
const room = await client.joinOrCreate(ROOM_NAME, { uid: `test:loop-${Date.now().toString(36)}`, name: 'LoopBot' })
const results = []
const levelUps = []
const rewards = []
room.onMessage('result', (m) => results.push(m))
room.onMessage('levelup', (m) => levelUps.push(m))
room.onMessage('reward', (m) => rewards.push(m))
room.onMessage('*', () => {})
room.send('hello')
await wait(500)
const me = () => room.state.players.get(room.sessionId)
const lastResult = (action) => [...results].reverse().find((r) => r.action === action)
const jumpsNow = () => jumpsFor(me().level, me().rebirths)
const speedNow = () => playerMoveStats(me()).speed

let pos = { x: spawn.x, y: spawn.y, z: spawn.z }
const send = (x, y, z, air = false, s = 0) => {
  pos = { x, y, z }
  room.send('move', { x, y, z, r: Math.PI, s, a: air ? 1 : 0, f: 0 })
}
const home = async () => {
  send(spawn.x, spawn.y, spawn.z)
  await wait(300)
}

/** Ground height (and whether it's a gap) along the course at z. */
function groundAt(z) {
  if (inLobby(z)) return { y: 0.2, x: 0 }
  for (const stage of layout.stages) {
    for (const p of stage.platforms) {
      if (z <= p.z0 && z >= p.z1) return { y: p.y, x: Math.min(Math.max(0, p.x0 + 2), p.x1 - 2) }
    }
    if (z <= stage.plateauZ0 && z >= stage.plateauZ1) return { y: stage.floorY, x: 0 }
    if (z <= stage.zStart + 0.01 && z > stage.platforms[0].z0) return { y: stage.prevTop + 0.2, x: 0 }
  }
  return null
}

/** Runs at the boots' speed from where we are to (x, z), over the platforms (in the air over gaps). */
async function runTo(tx, tz, ty = null) {
  const speed = speedNow()
  for (let guard = 0; guard < 20000; guard += 1) {
    const dz = tz - pos.z
    const dx = tx - pos.x
    const left = Math.hypot(dx, dz)
    const step = speed * (TICK / 1000)
    if (left <= step) break
    const k = step / left
    const nz = pos.z + dz * k
    const g = groundAt(nz)
    const nx = Math.abs(dz) > 20 ? (g?.x ?? pos.x) : pos.x + dx * k
    send(nx, g ? g.y : pos.y + 0.5, nz, !g, speed)
    await wait(TICK)
  }
  send(tx, ty ?? groundAt(tz)?.y ?? pos.y, tz, false, 0)
  await wait(200)
}

/** Stands on the best open jump pad until at the level (or for `maxMs`). */
async function train(level, maxMs = 120_000) {
  const pads = layout.jumpPads
  const best = [...pads].reverse().find((p) => {
    const def = PAD_BY_ID[p.id]
    return me().rebirths >= def.rebirths && (!def.price || me().padsOwned.split(',').includes(def.id))
  })
  const t0 = Date.now()
  send(best.center[0], best.top + 2, best.center[1], true)
  while (me().level < level && Date.now() - t0 < maxMs) {
    send(best.center[0], best.top + 2, best.center[1], true)
    await wait(250)
  }
  await home()
}

/** Teleports to the best stage's checkpoint (if any) and runs to `index`'s Return pad. */
async function runStage(index) {
  const best = me().bestStage
  if (best >= 1) {
    room.send('checkpoint', { stage: best })
    await wait(400)
    const cp = lastResult('checkpoint')
    if (cp?.ok) {
      send(cp.x, cp.y, cp.z)
      await wait(300)
    }
  } else {
    await home()
  }
  const pad = layout.pads.find((p) => p.stage === index && p.kind === 'return')
  const px = (pad.min[0] + pad.max[0]) / 2
  const pz = (pad.min[2] + pad.max[2]) / 2
  const stage = layout.stages[index - 1]
  await runTo(0, stage.plateauZ0 - 2)
  await runTo(px, pz, pad.max[1])
  const before = rewards.length
  room.send('pad', { stage: index, kind: 'return' })
  await wait(500)
  const ok = rewards.length > before
  if (!ok) log(`stage ${index} pad refused: ${JSON.stringify(lastResult('pad'))}`)
  await home()
  return ok
}

async function buy(cat, id) {
  room.send('buy', { cat, id })
  await wait(400)
  return lastResult('buy')
}

// --- Play ------------------------------------------------------------------
check('a new player starts at level 0 with 1 jump', me().level === 0 && jumpsNow() === 1, `level ${me().level}`)
let padBought = false
const firstLevelAt = {}
while (me().rebirths === 0 && Date.now() - started < GIVE_UP_MS) {
  // At MAX, keep going while a stage this rebirth can do is left; rebirth after.
  const nextRow = STAGE_TABLE[me().bestStage]
  if (me().level >= maxLevel() && (!nextRow || nextRow.rebirths > me().rebirths)) {
    log(`level ${me().level}, best stage ${me().bestStage}: rebirth!`)
    break
  }
  for (const up of levelUps.splice(0)) {
    firstLevelAt[up.to] ??= clock()
    if (up.jumpsTo > up.jumpsFrom) log(`level ${up.to}: ${up.jumpsTo} jumps`)
  }
  // A pad for Wins once there's change to spare.
  if (!padBought && me().wins >= PAD_BY_ID.pad2.price + 20) {
    const r = await buy('pad', 'pad2')
    padBought = Boolean(r?.ok)
    log(`bought the Super Pad: ${JSON.stringify(r)}`)
  }
  const next = me().bestStage + 1
  const row = STAGE_TABLE[next - 1]
  if (!row || row.rebirths > me().rebirths) {
    // Every stage this rebirth can do is done: train to MAX.
    await train(maxLevel(), 60_000)
    continue
  }
  const owned = me().bootsOwned.split(',')
  if (!owned.includes(row.boot)) {
    const price = BOOT_BY_ID[row.boot].price
    if (me().wins >= price) {
      const r = await buy('boot', row.boot)
      log(`bought ${row.boot} for ${price}: ${r?.ok ? 'ok' : JSON.stringify(r)}`)
    } else if (me().bestStage >= 1) {
      // Not enough Wins: run the best stage again.
      await runStage(me().bestStage)
    } else {
      await train(me().level + 1, 20_000)
    }
    continue
  }
  if (jumpsNow() < row.jumps) {
    await train(Math.ceil((15 * (row.jumps - 1 - me().rebirths)) / 4), 120_000)
    continue
  }
  const ok = await runStage(next)
  if (ok) log(`stage ${next} beaten (wins ${me().wins}, level ${me().level}, ${jumpsNow()} jumps, boots ${me().boot})`)
}

check('levels come from steps, jumps and the pad', me().level >= maxLevel(), `level ${me().level}; first reached: ${JSON.stringify(firstLevelAt)}`)
check('the first ten stages were beaten', me().bestStage >= 10, `best stage ${me().bestStage}`)
check('boots were bought on the way', me().bootsOwned.split(',').length >= 5, me().bootsOwned)
check('a jump pad was bought with Wins', padBought && me().padsOwned.includes('pad2'), me().padsOwned)

// --- Rebirth -----------------------------------------------------------------
const before = { wins: me().wins, boots: me().bootsOwned, best: me().bestStage, jumps: jumpsNow() }
room.send('rebirth')
await wait(500)
const r = lastResult('rebirth')
check('rebirth at level 15', r?.ok && me().rebirths === 1 && me().level === 0, JSON.stringify(r))
check('the rebirth gives +1 jump for good (2 at level 0)', jumpsNow() === 2 && r?.jumps === 2, `${jumpsNow()} jumps (was ${before.jumps} at level 15)`)
check('Wins, boots and stages are kept', me().wins === before.wins && me().bootsOwned === before.boots && me().bestStage === before.best)
check('XP is doubled (x2)', r?.mult === 2)

// --- Teleport: only to stages already reached ---------------------------------
await wait(2100)
room.send('checkpoint', { stage: 15 })
await wait(400)
const far = lastResult('checkpoint')
check('the teleport never goes past your best stage', far?.ok && far.stage === me().bestStage, JSON.stringify({ asked: 15, got: far?.stage, best: me().bestStage }))
await wait(2100)
room.send('checkpoint', { stage: 3 })
await wait(400)
check('the teleport goes to any stage reached', lastResult('checkpoint')?.stage === 3)
await home()
await wait(2100)
room.send('world', { id: 2 })
await wait(400)
check('World 2 opens after the rebirth', lastResult('world')?.ok === true, JSON.stringify(lastResult('world')))

console.log(`\nLoop done in ${clock()}.`)
await room.leave()
console.log(process.exitCode ? '\nSome checks failed.' : '\nAll checks passed.')
process.exit()

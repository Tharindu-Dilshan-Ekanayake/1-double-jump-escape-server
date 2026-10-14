/**
 * Smoke test against a running server (`npm start` first).
 *
 * Connects 17 bots and checks Colyseus splits them 8 / 8 / 1 across lobbies, then
 * drives one bot around to confirm Jump ticks, trampolines, pads (and their
 * anti-teleport check), purchases, rebirths and checkpoints work.
 *
 *   npm run test:lobbies            # ws://localhost:2567
 *   node scripts/lobby-test.js ws://my-host:2567
 */
import { Client } from '@colyseus/sdk'

import { ROOM_NAME } from '../src/shared/gameData.js'
import { getLayout } from '../src/shared/layout.js'

const endpoint = process.argv[2] || 'ws://localhost:2567'
const BOTS = 17
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

const client = new Client(endpoint)
const rooms = []
for (let i = 0; i < BOTS; i += 1) {
  const room = await client.joinOrCreate(ROOM_NAME, { uid: `test:bot-${i}`, name: `Bot${i}` })
  room.onMessage('*', () => {})
  rooms.push(room)
}
await wait(300)

const byRoom = new Map()
for (const room of rooms) byRoom.set(room.roomId, (byRoom.get(room.roomId) || 0) + 1)
const sizes = [...byRoom.values()]
check('17 bots split into lobbies of at most 8', sizes.every((n) => n <= 8), `sizes ${sizes.join('/')}`)
check('three lobbies were created', byRoom.size === 3, `${byRoom.size} lobbies`)
check('first lobby is full', rooms[0].state.players.size === 8, `${rooms[0].state.players.size} players`)

// Bot 16 sits alone in the third lobby: no friend bonus to muddy the numbers.
const bot = rooms[16]
const gains = []
const results = []
const rewards = []
bot.onMessage('gain', (m) => gains.push(m))
bot.onMessage('result', (m) => results.push(m))
bot.onMessage('reward', (m) => rewards.push(m))
const me = () => bot.state.players.get(bot.sessionId)
const lastResult = (action) => [...results].reverse().find((r) => r.action === action)
const move = (x, y, z, a = 0) => bot.send('move', { x, y, z, r: Math.PI, s: 16, a })

const layout = getLayout()
const spawn = layout.spawn

// Walk around the lobby: Jump ticks should arrive about once a second.
for (let i = 0; i < 50; i += 1) {
  move(spawn.x + Math.sin(i / 5) * 6, 0.2, spawn.z - (i % 10) * 0.8)
  if (i % 8 === 0) bot.send('jump')
  await wait(50)
}
await wait(200)
check('Jump ticks arrive while moving', gains.length >= 2, `${gains.length} ticks, total Jump ${me().totalJump}`)
const levelUps = []
bot.onMessage('levelup', (m) => levelUps.push(m))
bot.send('code', { code: 'DOUBLEJUMP' })
await wait(250)
check('Jump levels you up (+1 jump per level)', me().level >= 4 && levelUps.at(-1)?.jumpsTo === Math.min(5, me().level), `level ${me().level}, ${JSON.stringify(levelUps.at(-1))}`)

// Standing still on the free trampoline still pays (it bounces you).
const tramp = layout.trampolines[0]
gains.length = 0
for (let i = 0; i < 30; i += 1) {
  move(tramp.center[0], tramp.top + (i % 6), tramp.center[1], 1)
  await wait(80)
}
check('a trampoline pays while you bounce', gains.length >= 1 && gains.every((g) => g.t === 1), `${gains.length} ticks`)

// Teleporting straight onto Stage 1's Return pad must not pay.
const stage1 = layout.stages[0]
const pad = layout.pads.find((p) => p.stage === 1 && p.kind === 'return')
const padAt = [(pad.min[0] + pad.max[0]) / 2, pad.max[1], (pad.min[2] + pad.max[2]) / 2]
move(spawn.x, 0.2, 2)
await wait(120)
move(...padAt)
await wait(120)
bot.send('pad', { stage: 1, kind: 'return' })
await wait(250)
check('a teleport onto a pad is refused', lastResult('pad')?.code === 'invalid' && !rewards.length, JSON.stringify(lastResult('pad')))

// A believable run: walk from the lobby to the pad at running speed.
move(spawn.x, 0.2, 2)
await wait(400)
for (let z = 2; z > padAt[2]; z -= 1.2) {
  const y = z < stage1.plateauZ0 ? stage1.floorY : 0.2
  move(0, y, z, z < stage1.gateZ && z > stage1.plateauZ0 ? 1 : 0)
  await wait(55)
}
move(...padAt)
await wait(100)
bot.send('pad', { stage: 1, kind: 'return' })
await wait(250)
check('a real run onto the Return pad pays Wins', rewards.length === 1 && me().wins >= 1, `wins ${me().wins}, best stage ${me().bestStage}`)
check('the stage counts as reached', me().bestStage === 1)
const double = layout.pads.find((p) => p.stage === 1 && p.kind === 'double')
move((double.min[0] + double.max[0]) / 2, double.max[1], (double.min[2] + double.max[2]) / 2)
await wait(1700)
bot.send('pad', { stage: 1, kind: 'double' })
await wait(250)
check('the 2x pad needs the 2x Wins pass', lastResult('pad')?.code === 'needPass', JSON.stringify(lastResult('pad')))

// Buying: not enough Wins for Spring Boots, enough for Bouncy (3) after a code.
bot.send('buy', { cat: 'boot', id: 'spring' })
await wait(200)
check('buying without Wins is refused', lastResult('buy')?.code === 'poor', JSON.stringify(lastResult('buy')))
bot.send('code', { code: 'RELEASE' })
await wait(200)
check('a code pays Wins', lastResult('code')?.ok === true, `wins ${me().wins}`)
bot.send('code', { code: 'RELEASE' })
await wait(200)
check('a code only works once', lastResult('code')?.code === 'usedCode')
bot.send('buy', { cat: 'boot', id: 'bouncy' })
await wait(200)
check('boots can be bought and are equipped', me().boot === 'bouncy' && me().bootsOwned.includes('bouncy'), `wins ${me().wins}`)
bot.send('buy', { cat: 'tramp', id: 't3' })
await wait(200)
check('a trampoline can be unlocked', me().tramps.includes('t3'), me().tramps)
bot.send('equip', { cat: 'boot', id: 'starter' })
await wait(200)
check('owned boots can be re-equipped', me().boot === 'starter')

// Rebirth needs MAX level.
bot.send('rebirth')
await wait(200)
check('rebirth is refused before MAX level', lastResult('rebirth')?.code === 'notReady')

// Checkpoint door: go to the best stage's plateau.
bot.send('checkpoint', {})
await wait(200)
const cp = lastResult('checkpoint')
check('the checkpoint door sends you to your best stage', cp?.ok && cp.stage === 1, JSON.stringify(cp))

// Goals advance (reach level 2, beat stage 1, ...).
check('goals advance', me().goal >= 2, `goal #${me().goal}`)

for (const room of rooms) await room.leave()
console.log(process.exitCode ? '\nSome checks failed.' : '\nAll checks passed.')
process.exit()

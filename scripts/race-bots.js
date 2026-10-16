/**
 * Dev helper: N bots that join a lobby and run down the course at different
 * speeds (looping back to the lobby), so the race tracker, remote players and
 * feed can be seen with company. Bots use `test:` uids, so nothing is saved.
 *
 *   node scripts/race-bots.js [count=5] [ws://localhost:2567]
 */
import { Client } from '@colyseus/sdk'

import { ROOM_NAME } from '../src/shared/gameData.js'
import { getLayout } from '../src/shared/layout.js'

const count = Number(process.argv[2]) || 5
const endpoint = process.argv[3] || 'ws://localhost:2567'
const NAMES = ['Nimal', 'Kasun', 'Sanduni', 'Ravi', 'Dilini', 'Amaya', 'Tharu', 'Isuru']
const layout = getLayout()
const client = new Client(endpoint)

for (let i = 0; i < count; i += 1) {
  const room = await client.joinOrCreate(ROOM_NAME, { uid: `test:racebot-${i}`, name: NAMES[i % NAMES.length] })
  room.onMessage('*', () => {})
  const speed = 18 + i * 9
  let z = layout.spawn.z - i * 2
  let x = (i - count / 2) * 3
  let pause = 0
  setInterval(() => {
    if (pause > 0) {
      pause -= 0.05
      return
    }
    z -= speed * 0.05
    const stage = layout.stages.find((s) => z <= s.zStart && z >= s.plateauZ1)
    const y = stage ? stage.floorY + 0.2 : 0.2
    if (z < layout.stages[Math.min(19, 3 + i * 2)].plateauZ1 + 5) {
      // Back to the lobby for another run.
      z = layout.spawn.z
      x = (i - count / 2) * 3
      pause = 2 + i
    }
    room.send('move', { x, y, z, r: Math.PI, s: speed, a: 0 })
    if (Math.random() < 0.05) room.send('jump', {})
  }, 50)
}
console.log(`${count} bots racing on ${endpoint}`)

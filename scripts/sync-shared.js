/**
 * Copies the shared game rules from the client repo into `src/shared/`.
 *
 * The client (`../1-double-jump-escape-client/src/shared`) is the source of
 * truth; both sides must run identical rules or the server will reject claims the
 * client thinks are valid. Pass a different client path as the first argument.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(
  process.argv[2] || path.join(here, '..', '..', '1-double-jump-escape-client', 'src', 'shared'),
)
const target = path.join(here, '..', 'src', 'shared')

mkdirSync(target, { recursive: true })
for (const file of readdirSync(source)) {
  if (!file.endsWith('.js')) continue
  copyFileSync(path.join(source, file), path.join(target, file))
  console.log(`synced ${file}`)
}

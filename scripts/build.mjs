import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'src')
const lib = join(root, 'lib')

await rm(lib, { recursive: true, force: true })
await mkdir(lib, { recursive: true })
await cp(src, lib, { recursive: true })
console.log(`built ${lib}`)

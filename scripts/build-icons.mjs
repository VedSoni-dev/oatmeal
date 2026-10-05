import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
await mkdir('build', { recursive: true })
await sharp('build/icon.svg').png().toFile('build/icon.png')

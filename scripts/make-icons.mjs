/**
 * Generates all app icons from resources/icon.svg:
 *   resources/icon.png   (1024×1024, also 512 copy for Linux)
 *   resources/icon.icns  (macOS, via iconutil)
 *   resources/icon.ico   (Windows, via png-to-ico)
 * Run: node scripts/make-icons.mjs
 */
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const RES = 'resources'
const SVG = join(RES, 'icon.svg')
const ICONSET = join(RES, 'MyIcon.iconset')

// Render the SVG once at full 1024×1024, downscale for all other sizes
const master = await sharp(SVG, { density: 72 }).resize(1024, 1024).png().toBuffer()
const png = (size) => size === 1024 ? Promise.resolve(master) : sharp(master).resize(size, size).png().toBuffer()

// 2. macOS iconset → icns
rmSync(ICONSET, { recursive: true, force: true })
mkdirSync(ICONSET, { recursive: true })
const iconsetSizes = [
  ['icon_16x16.png', 16],      ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],      ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],   ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],   ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],   ['icon_512x512@2x.png', 1024],
]
for (const [name, size] of iconsetSizes) writeFileSync(join(ICONSET, name), await png(size))
execSync(`iconutil -c icns ${ICONSET} -o ${join(RES, 'icon.icns')}`)
rmSync(ICONSET, { recursive: true, force: true })

// 3. Windows .ico (multi-size)
const icoSizes = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(png))
writeFileSync(join(RES, 'icon.ico'), await pngToIco(icoSizes))

// 4. Linux 512 PNG
writeFileSync(join(RES, 'icon.png'), await png(512))
rmSync(join(RES, 'icon@1024.png'), { force: true })

console.log('✓ resources/icon.icns, icon.ico, icon.png generated from icon.svg')

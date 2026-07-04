// Generates the app icon: a scallop shell on a deep-teal rounded tile.
// Usage: bun scripts/make-icon.ts && bunx tauri icon src-tauri/icons/source.png
import sharp from 'sharp'

const S = 1024
const cx = S / 2
const apexY = 812 // hinge point at the bottom
const topY = 250 // where the fan's outer arc peaks

// Fan of ridges: rays from the apex to points along the outer arc.
const rays: string[] = []
const ARCS = 7
for (let i = 0; i <= ARCS; i++) {
  const t = i / ARCS
  const angle = Math.PI * (0.16 + 0.68 * t) // spread of the fan
  const rx = cx - Math.cos(angle) * 330
  const ry = topY + Math.sin(angle) * 60 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 130
  rays.push(`M ${cx} ${apexY} L ${rx.toFixed(1)} ${ry.toFixed(1)}`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0e2a2e"/>
      <stop offset="1" stop-color="#061417"/>
    </linearGradient>
    <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2dd4bf"/>
      <stop offset="1" stop-color="#0d9488"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="${S - 64}" height="${S - 64}" rx="224" fill="url(#bg)"/>
  <rect x="32" y="32" width="${S - 64}" height="${S - 64}" rx="224" fill="none" stroke="#2dd4bf" stroke-opacity="0.25" stroke-width="10"/>
  <!-- shell body: fan bounded by two edge rays and the outer arc -->
  <path d="M ${cx} ${apexY}
           L ${cx - 310} ${topY + 190}
           Q ${cx - 210} ${topY - 40} ${cx} ${topY - 60}
           Q ${cx + 210} ${topY - 40} ${cx + 310} ${topY + 190}
           Z"
        fill="url(#shell)"/>
  <!-- ridges -->
  <g stroke="#062f2c" stroke-width="16" stroke-linecap="round" opacity="0.55">
    ${rays.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
  <!-- hinge -->
  <circle cx="${cx}" cy="${apexY}" r="46" fill="#0d9488" stroke="#062f2c" stroke-width="12"/>
</svg>`

await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile('src-tauri/icons/source.png')
console.log('wrote src-tauri/icons/source.png')

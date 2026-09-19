import sharp from 'sharp'
import fs from 'node:fs'
for (const f of fs.readdirSync('shots')) {
  const out = 'img/' + f.replace('.png', '.jpg')
  await sharp('shots/' + f).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(out)
}
console.log(fs.readdirSync('img').map(f => f + ' ' + Math.round(fs.statSync('img/' + f).size / 1024) + 'KB').join('\n'))

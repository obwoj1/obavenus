const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const iconset = process.argv[2];
const output = process.argv[3];
if (!iconset || !output) throw new Error('Usage: node pack-icns.cjs ICONSET OUTPUT');
const entries = [
  ['icp4', 'icon_16x16.png'], ['icp5', 'icon_32x32.png'], ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'], ['ic08', 'icon_256x256.png'], ['ic09', 'icon_512x512.png'], ['ic10', 'icon_512x512@2x.png'],
  ['ic11', 'icon_16x16@2x.png'], ['ic12', 'icon_32x32@2x.png'], ['ic13', 'icon_128x128@2x.png'], ['ic14', 'icon_256x256@2x.png'],
];
async function main() {
  const chunks = [];
  for (const [type, filename] of entries) {
    const data = await readFile(path.join(iconset, filename));
    if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${filename} is not a PNG image.`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + header.length, 4);
    chunks.push(header, data);
  }
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(payload.length + header.length, 4);
  await writeFile(output, Buffer.concat([header, payload]));
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

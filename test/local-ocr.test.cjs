const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { createLocalOcr } = require('../electron/local-ocr.cjs');
const { readProjectFile } = require('../electron/project.cjs');

function makeScannedPdf(jpeg) {
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.from('<< /Length 39 >>\nstream\nq 612 0 0 245 0 250 cm /Im0 Do Q\nendstream'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  ];
  let pdf = Buffer.from('%PDF-1.4\n');
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
  });
  const xref = pdf.length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(table)]);
}

test('bundled offline OCR reads images and scanned PDF pages, then closes its worker', async () => {
  const canvas = createCanvas(1000, 400);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1000, 400);
  context.fillStyle = '#111';
  context.font = '48px Arial';
  context.fillText('Obavenus scanned test', 40, 200);

  const image = canvas.toBuffer('image/png');
  const recognize = createLocalOcr();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-scanned-pdf-'));
  try {
    assert.match(await recognize(image), /Obavenus scanned test/i);
    await writeFile(path.join(directory, 'scan.pdf'), makeScannedPdf(canvas.toBuffer('image/jpeg')));
    const pdf = await readProjectFile(directory, 'scan.pdf', { ocrImage: recognize });
    assert.match(pdf.content, /Obavenus scanned test/i);
    await assert.rejects(recognize(Buffer.alloc(0)), /non-empty/);
  } finally { await recognize.close(); await rm(directory, { recursive: true, force: true }); }
});

const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile, symlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCanvas } = require('@napi-rs/canvas');
const { buildDocument } = require('../electron/artifacts.cjs');
const { createLocalOcr } = require('../electron/local-ocr.cjs');
const { readResumeFile } = require('../electron/resume-file.cjs');

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
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); });
  const xref = pdf.length;
  return Buffer.concat([pdf, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
}

test('resume import extracts TXT, DOCX, and offline OCR from scanned PDFs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-resume-'));
  const canvas = createCanvas(1000, 400);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 1000, 400);
  context.fillStyle = '#111'; context.font = '48px Arial'; context.fillText('Resume OCR check', 40, 200);
  const recognize = createLocalOcr();
  try {
    const textFile = path.join(root, 'resume.txt');
    const wordFile = path.join(root, 'resume.docx');
    const pdfFile = path.join(root, 'resume.pdf');
    await writeFile(textFile, 'Text resume experience.');
    await writeFile(wordFile, await buildDocument({ title: 'Resume', sections: [{ heading: 'Experience', text: 'DOCX resume experience.' }] }));
    await writeFile(pdfFile, makeScannedPdf(canvas.toBuffer('image/jpeg')));
    assert.match((await readResumeFile(textFile)).text, /Text resume experience/);
    assert.match((await readResumeFile(wordFile)).text, /DOCX resume experience/);
    assert.match((await readResumeFile(pdfFile, { ocrImage: recognize })).text, /Resume OCR check/i);
    await assert.rejects(readResumeFile(path.join(root, 'resume.exe')), /TXT, Markdown, PDF, or DOCX/);
    await symlink(textFile, path.join(root, 'resume-link.txt'));
    await assert.rejects(readResumeFile(path.join(root, 'resume-link.txt')), /regular local file/);
  } finally { await recognize.close(); await rm(root, { recursive: true, force: true }); }
});

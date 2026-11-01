const ExcelJS = require('exceljs');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');

const OFFICE_EXTENSIONS = Object.freeze({ spreadsheet: ['.xlsx'], document: ['.docx'], presentation: ['.pptx'] });
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

function boundedText(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new TypeError(`${label} must contain 1–${limit} characters.`);
  return value.trim();
}
function safeCell(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Spreadsheet values must be finite numbers.');
    return value ?? null;
  }
  if (typeof value !== 'string' || value.length > 10_000) throw new TypeError('Spreadsheet cells must be text, numbers, booleans, or blank (10,000 characters maximum).');
  return /^[\s]*[=+@\-]/.test(value) ? `'${value}` : value;
}

async function buildSpreadsheet({ sheets }) {
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > 10) throw new TypeError('A spreadsheet needs 1–10 worksheets.');
  let rowCount = 0;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Obavenus';
  workbook.created = new Date();
  for (const sheet of sheets) {
    const name = boundedText(sheet?.name, 'Worksheet name', 31).replace(/[\\/?*:[\]]/g, ' ').trim();
    if (!name) throw new TypeError('Worksheet name must contain a letter or number.');
    if (!Array.isArray(sheet.headers) || sheet.headers.length < 1 || sheet.headers.length > 40) throw new TypeError('Each worksheet needs 1–40 column headings.');
    if (!Array.isArray(sheet.rows) || sheet.rows.length > 1000) throw new TypeError('Each worksheet can contain up to 1,000 data rows.');
    rowCount += sheet.rows.length;
    if (rowCount > 5000) throw new RangeError('A spreadsheet can contain up to 5,000 data rows total.');
    const headers = sheet.headers.map((value) => boundedText(String(value), 'Column heading', 120));
    const worksheet = workbook.addWorksheet(name);
    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF718B74' } };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.columns = headers.map((header) => ({ width: Math.max(12, Math.min(36, header.length + 4)) }));
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length !== headers.length) throw new TypeError('Every data row must have the same number of cells as its headings.');
      worksheet.addRow(row.map(safeCell));
    }
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rows.length + 1, column: headers.length } };
  }
  const output = Buffer.from(await workbook.xlsx.writeBuffer());
  if (output.length > MAX_ARTIFACT_BYTES) throw new RangeError('The generated spreadsheet exceeds the 8 MB artifact limit.');
  return output;
}

async function updateSpreadsheet({ bytes, sheet: sheetName, cells }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new RangeError('Open an existing spreadsheet up to 8 MB.');
  const wantedSheet = boundedText(sheetName, 'Worksheet name', 31);
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 200) throw new RangeError('Update 1–200 cells per operation.');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); } catch { throw new TypeError('The selected file is not a readable .xlsx workbook.'); }
  const worksheet = workbook.getWorksheet(wantedSheet);
  if (!worksheet) throw new TypeError(`No worksheet is named “${wantedSheet}”.`);
  const seen = new Set();
  const verified = [];
  for (const item of cells) {
    if (!item || typeof item.address !== 'string' || !/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/i.test(item.address)) throw new TypeError('Use a single spreadsheet cell address such as B12.');
    const address = item.address.replaceAll('$', '').toUpperCase();
    if (seen.has(address)) throw new TypeError(`Cell ${address} appears more than once.`);
    seen.add(address);
    const column = address.match(/[A-Z]+/)[0].split('').reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
    const row = Number(address.match(/\d+/)[0]);
    if (column > 200 || row > 100_000) throw new RangeError('Cell updates are limited to columns A–GR and rows 1–100,000.');
    const value = safeCell(item.value);
    worksheet.getCell(address).value = value;
    verified.push({ address, value });
  }
  const output = Buffer.from(await workbook.xlsx.writeBuffer());
  if (output.length > MAX_ARTIFACT_BYTES) throw new RangeError('The updated spreadsheet exceeds the 8 MB artifact limit.');
  const check = new ExcelJS.Workbook();
  await check.xlsx.load(output);
  const resultSheet = check.getWorksheet(wantedSheet);
  return { bytes: output, updated: verified.map(({ address }) => ({ address, value: resultSheet.getCell(address).value })) };
}

function decodeXmlText(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function encodeXmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function replaceOfficeText({ bytes, extension, oldText, newText }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES) throw new RangeError('Open an existing Office file up to 8 MB.');
  if (!['.docx', '.pptx'].includes(extension)) throw new TypeError('Text replacement supports Word (.docx) and PowerPoint (.pptx) files.');
  if (typeof oldText !== 'string' || !oldText.trim() || oldText.length > 20_000 || typeof newText !== 'string' || newText.length > 20_000 || newText.includes('\0')) throw new TypeError('Provide an exact non-empty passage and replacement text up to 20,000 characters.');
  if (oldText === newText) throw new TypeError('The replacement is identical to the existing text.');
  let archive;
  try { archive = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false }); } catch { throw new TypeError('The selected file is not a readable Office document.'); }
  const entries = Object.entries(archive.files).filter(([, entry]) => !entry.dir);
  if (entries.length > 5_000) throw new RangeError('Office archive contains too many entries.');
  let expanded = 0;
  for (const [name, entry] of entries) {
    if (name.split('/').some((part) => part === '..')) throw new TypeError('Office archive contains an unsafe path.');
    expanded += entry._data?.uncompressedSize || 0;
    if (expanded > 40 * 1024 * 1024) throw new RangeError('Office archive expands beyond the 40 MB editing limit.');
  }
  const target = extension === '.docx' ? /^word\/document\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/;
  const nodes = extension === '.docx' ? /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g : /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let matches = 0;
  const edits = [];
  for (const [name, entry] of entries) {
    if (!target.test(name)) continue;
    const xml = await entry.async('string');
    let changed = false;
    const updated = xml.replace(nodes, (whole, rawText) => {
      const text = decodeXmlText(rawText);
      let index = text.indexOf(oldText);
      if (index < 0) return whole;
      const count = text.split(oldText).length - 1;
      matches += count;
      if (matches > 1 || count > 1) return whole;
      const replaced = text.slice(0, index) + newText + text.slice(index + oldText.length);
      changed = true;
      return whole.replace(rawText, encodeXmlText(replaced));
    });
    if (changed) edits.push({ name, xml: updated });
  }
  if (matches === 0) throw new Error('The exact text was not found within one formatted text run. Select a shorter passage contained in one Word or PowerPoint text run.');
  if (matches > 1) throw new Error('The exact text occurs more than once. Include more surrounding text so the target is unique.');
  for (const edit of edits) archive.file(edit.name, edit.xml);
  const output = Buffer.from(await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  if (output.length > MAX_ARTIFACT_BYTES) throw new RangeError('The edited Office file exceeds the 8 MB limit.');
  return { bytes: output, replacements: 1, format: extension === '.docx' ? 'Word document' : 'PowerPoint presentation' };
}

async function buildDocument({ title, sections }) {
  const documentTitle = boundedText(title, 'Document title', 180);
  if (!Array.isArray(sections) || sections.length > 30) throw new TypeError('A document can contain up to 30 sections.');
  let totalCharacters = 0;
  const children = [new Paragraph({ text: documentTitle, heading: HeadingLevel.TITLE })];
  for (const section of sections) {
    if (section.heading) children.push(new Paragraph({ text: boundedText(section.heading, 'Section heading', 180), heading: HeadingLevel.HEADING_1 }));
    const text = boundedText(section.text, 'Section text', 20_000);
    totalCharacters += text.length;
    if (totalCharacters > 100_000) throw new RangeError('Document text exceeds 100,000 characters.');
    for (const line of text.split(/\n{2,}/)) children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const output = await Packer.toBuffer(new Document({ creator: 'Obavenus', title: documentTitle, sections: [{ children }] }));
  if (output.length > MAX_ARTIFACT_BYTES) throw new RangeError('The generated document exceeds the 8 MB artifact limit.');
  return output;
}

async function buildPresentation({ title, slides }) {
  const presentationTitle = boundedText(title, 'Presentation title', 180);
  if (!Array.isArray(slides) || slides.length < 1 || slides.length > 30) throw new TypeError('A presentation needs 1–30 slides.');
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Obavenus';
  pptx.subject = presentationTitle;
  pptx.title = presentationTitle;
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-US' };
  slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'F5F7F2' };
    const heading = index === 0 && !item.title ? presentationTitle : boundedText(item.title || presentationTitle, 'Slide title', 180);
    slide.addText(heading, { x: 0.65, y: 0.55, w: 12, h: 0.8, fontFace: 'Aptos Display', fontSize: 28, bold: true, color: '344438', margin: 0.02, breakLine: false });
    if (item.subtitle) slide.addText(boundedText(item.subtitle, 'Slide subtitle', 500), { x: 0.68, y: 1.4, w: 11.8, h: 0.65, fontSize: 17, color: '718B74', margin: 0.02 });
    if (!Array.isArray(item.bullets) || item.bullets.length > 10) throw new TypeError('Each slide can contain up to 10 bullet points.');
    const bullets = item.bullets.map((bullet) => ({ text: boundedText(bullet, 'Bullet point', 1000), options: { bullet: { indent: 18 }, hanging: 4, breakLine: true } }));
    const y = item.subtitle ? 2.15 : 1.75;
    if (bullets.length) slide.addText(bullets, { x: 0.82, y, w: 11.5, h: 4.75, fontSize: 19, color: '344438', breakLine: false, paraSpaceAfterPt: 14, valign: 'top', margin: 0.08, fit: 'shrink' });
    slide.addText(`${index + 1} / ${slides.length}`, { x: 11.9, y: 7.05, w: 0.75, h: 0.2, fontSize: 9, color: '78877B', align: 'right', margin: 0 });
  });
  const output = Buffer.from(await pptx.write({ outputType: 'nodebuffer', compression: true }));
  if (output.length > MAX_ARTIFACT_BYTES) throw new RangeError('The generated presentation exceeds the 8 MB artifact limit.');
  return output;
}

module.exports = { buildSpreadsheet, updateSpreadsheet, replaceOfficeText, buildDocument, buildPresentation, OFFICE_EXTENSIONS, MAX_ARTIFACT_BYTES };

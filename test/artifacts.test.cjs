const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { buildSpreadsheet, updateSpreadsheet, buildDocument, buildPresentation } = require('../electron/artifacts.cjs');

test('native spreadsheet generation creates a frozen workbook and neutralizes formula-like text', async () => {
  const data = await buildSpreadsheet({ sheets: [{ name: 'Open roles', headers: ['Role', 'Salary'], rows: [['=HYPERLINK("bad")', 172000]] }] });
  assert.equal(data.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sheet = workbook.getWorksheet('Open roles');
  assert.equal(sheet.getCell('A2').value, "'=HYPERLINK(\"bad\")");
  assert.equal(sheet.getCell('B2').value, 172000);
  assert.equal(sheet.views[0].ySplit, 1);
});

test('existing workbooks support bounded typed cell updates and read-back without formula injection', async () => {
  const original = await buildSpreadsheet({ sheets: [{ name: 'Budget', headers: ['Item', 'Amount'], rows: [['Transit', 25]] }] });
  const edited = await updateSpreadsheet({ bytes: original, sheet: 'Budget', cells: [
    { address: 'B2', value: 340 },
    { address: 'A3', value: '=HYPERLINK("bad")' },
  ] });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(edited.bytes);
  const sheet = workbook.getWorksheet('Budget');
  assert.equal(sheet.getCell('B2').value, 340);
  assert.equal(sheet.getCell('A3').value, "'=HYPERLINK(\"bad\")");
  assert.deepEqual(edited.updated, [{ address: 'B2', value: 340 }, { address: 'A3', value: "'=HYPERLINK(\"bad\")" }]);
  await assert.rejects(updateSpreadsheet({ bytes: original, sheet: 'Missing', cells: [{ address: 'A1', value: 'x' }] }), /No worksheet/);
  await assert.rejects(updateSpreadsheet({ bytes: original, sheet: 'Budget', cells: [{ address: 'A1:B2', value: 'x' }] }), /single spreadsheet cell/);
  await assert.rejects(updateSpreadsheet({ bytes: original, sheet: 'Budget', cells: [{ address: 'A1', value: '=SUM(1,2)' }, { address: 'a1', value: 4 }] }), /appears more than once/);
});

test('native Word and PowerPoint generators return Office Open XML packages', async () => {
  const docx = await buildDocument({ title: 'Hiring brief', sections: [{ heading: 'Summary', text: 'Compare the posted roles.' }] });
  const pptx = await buildPresentation({ title: 'Hiring brief', slides: [{ title: 'Summary', bullets: ['Compare salary and duties.'] }] });
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  assert.equal(pptx.subarray(0, 2).toString(), 'PK');
  assert.ok(docx.length > 1000);
  assert.ok(pptx.length > 1000);
});

test('native office generators enforce bounded schemas before building files', async () => {
  await assert.rejects(buildSpreadsheet({ sheets: [] }), /1–10 worksheets/);
  await assert.rejects(buildSpreadsheet({ sheets: [{ name: 'Data', headers: ['A'], rows: [['x', 'extra']] }] }), /same number of cells/);
  await assert.rejects(buildDocument({ title: 'x', sections: Array.from({ length: 31 }, () => ({ text: 'x' })) }), /up to 30 sections/);
  await assert.rejects(buildPresentation({ title: 'x', slides: [] }), /1–30 slides/);
});

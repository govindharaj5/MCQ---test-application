// ============================================================================
// Export helpers — build CSV text and .xlsx workbooks from results data
// ============================================================================
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Name', key: 'student_name', width: 24 },
  { header: 'Register Number', key: 'register_number', width: 20 },
  { header: 'Mobile Number', key: 'mobile_number', width: 16 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Start Time', key: 'start_time', width: 22 },
  { header: 'Submitted At', key: 'submitted_at', width: 22 },
  { header: 'Time Taken (mm:ss)', key: 'time_taken_display', width: 18 },
  { header: 'Score', key: 'score', width: 10 },
  { header: 'Total Marks', key: 'total_marks', width: 12 },
  { header: 'Percentage', key: 'percentage', width: 12 },
];

function formatTimeTaken(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function prepRows(attempts) {
  return attempts.map((a) => ({
    ...a,
    status: a.status === 'completed' ? 'Completed' : a.status === 'expired' ? 'Expired' : 'In Progress',
    time_taken_display: formatTimeTaken(a.time_taken_seconds),
    score: a.score ?? '',
    total_marks: a.total_marks ?? '',
    percentage: a.percentage !== null && a.percentage !== undefined ? `${a.percentage}%` : '',
  }));
}

/** Escapes a single CSV field per RFC 4180. */
function csvField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(attempts) {
  const rows = prepRows(attempts);
  const header = COLUMNS.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((row) => COLUMNS.map((c) => csvField(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

async function buildXlsx(attempts, testTitle) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MCQ Test Application';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Results', {
    views: [{ state: 'frozen', ySplit: 1 }], // freeze header row
  });
  sheet.columns = COLUMNS;

  const rows = prepRows(attempts);
  sheet.addRows(rows);

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2A4A' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 20;

  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLUMNS.length)}1` };

  // Add a small summary block below the data
  const startRow = rows.length + 3;
  sheet.getCell(`A${startRow}`).value = `Results for: ${testTitle}`;
  sheet.getCell(`A${startRow}`).font = { bold: true };
  sheet.getCell(`A${startRow + 1}`).value = `Exported: ${new Date().toISOString()}`;

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildCsv, buildXlsx };

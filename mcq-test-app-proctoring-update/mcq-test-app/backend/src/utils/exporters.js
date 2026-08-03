// ============================================================================
// Export helpers — build CSV text, .xlsx workbooks, and PDF reports from
// results data (Phase 2, Feature 15: CSV/Excel/PDF export + analytics).
// ============================================================================
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COLUMNS = [
  { header: 'Name', key: 'student_name', width: 24 },
  { header: 'College Name', key: 'register_number', width: 20 },
  { header: 'Designation', key: 'mobile_number', width: 16 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Start Time', key: 'start_time', width: 22 },
  { header: 'Submitted At', key: 'submitted_at', width: 22 },
  { header: 'Time Taken (mm:ss)', key: 'time_taken_display', width: 18 },
  { header: 'Score', key: 'score', width: 10 },
  { header: 'Total Marks', key: 'total_marks', width: 12 },
  { header: 'Percentage', key: 'percentage', width: 12 },
  { header: 'Result', key: 'result', width: 10 }, // NEW (Feature 15): Pass / Fail / —
  // Proctoring — violation counts, always present (0 for tests that don't
  // have proctoring enabled), so exports stay a single consistent shape.
  { header: 'Tab Switches', key: 'tab_switch_count', width: 14 },
  { header: 'Webcam Violations', key: 'webcam_violation_count', width: 16 },
  { header: 'Fullscreen Exits', key: 'fullscreen_violation_count', width: 16 },
];

const STATUS_LABELS = {
  in_progress: 'In Progress',
  completed: 'Completed',
  auto_submitted: 'Auto Submitted',
  cheating_detected: 'Cheating Detected',
  expired: 'Expired',
};

function formatTimeTaken(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function prepRows(attempts, passPercentage = 40) {
  return attempts.map((a) => ({
    ...a,
    // Prefers the derived `display_status` (set by resultController) which
    // distinguishes Auto Submitted / Cheating Detected; falls back to the
    // original two-way label if an older caller doesn't provide it.
    status: STATUS_LABELS[a.display_status] || STATUS_LABELS[a.status] || 'In Progress',
    time_taken_display: formatTimeTaken(a.time_taken_seconds),
    score: a.score ?? '',
    total_marks: a.total_marks ?? '',
    percentage: a.percentage !== null && a.percentage !== undefined ? `${a.percentage}%` : '',
    result: a.percentage !== null && a.percentage !== undefined
      ? (a.percentage >= passPercentage ? 'Pass' : 'Fail')
      : '',
    tab_switch_count: a.tab_switch_count ?? 0,
    webcam_violation_count: a.webcam_violation_count ?? 0,
    fullscreen_violation_count: a.fullscreen_violation_count ?? 0,
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

function buildCsv(attempts, passPercentage = 40) {
  const rows = prepRows(attempts, passPercentage);
  const header = COLUMNS.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((row) => COLUMNS.map((c) => csvField(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

async function buildXlsx(attempts, testTitle, passPercentage = 40) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MCQ Test Application';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Results', {
    views: [{ state: 'frozen', ySplit: 1 }], // freeze header row
  });
  sheet.columns = COLUMNS;

  const rows = prepRows(attempts, passPercentage);
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

/**
 * PDF report (NEW — Feature 15): summary stats + question analytics + the
 * full results table. Built with pdfkit, which is pure JS (no native
 * dependencies), so it runs fine on Render/Vercel.
 */
function buildPdf(test, attempts, stats, analytics, passPercentage = 40) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const P = { margin: 40, pageW: 595.28 }; // A4 width
    const contentW = P.pageW - P.margin * 2;
    const now = new Date().toISOString();

    // ---- Header ----
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1B2A4A')
      .text(test.title, P.margin, 40);
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
      .text(`Exported: ${now}   |   Pass mark: ${passPercentage}%`, P.margin, 62);

    // ---- Summary stats ----
    doc.y = 86;
    const statLine = [
      `Total Students: ${stats.totalAttended}`,
      `Completed: ${stats.completedCount}`,
      `Passed: ${stats.passedCount}`,
      `Failed: ${stats.failedCount}`,
      `Average: ${stats.averageScore ?? '-'}`,
      `Highest: ${stats.highestScore ?? '-'}`,
      `Lowest: ${stats.lowestScore ?? '-'}`,
    ].join('   |   ');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text(statLine, P.margin, doc.y, {
      width: contentW, lineBreak: false,
    });

    // ---- Question analytics ----
    doc.y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B2A4A').text('Question Analytics');
    doc.y += 4;
    if (analytics.perQuestion.length) {
      analytics.perQuestion.forEach((q, i) => {
        const accuracy = q.accuracyPct === null ? 'no responses' : `${q.accuracyPct}%`;
        doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text(
          `${i + 1}. ${q.question_text}  —  accuracy ${accuracy}  (${q.correctCount} correct / ${q.wrongCount} wrong)`,
          P.margin, doc.y, { width: contentW },
        );
        if (doc.y > 650) doc.addPage();
      });
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor('#555555').text('No completed attempts yet.', P.margin, doc.y);
    }

    // ---- Results table ----
    doc.y += 14;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1B2A4A').text('Student Results');
    doc.y += 6;

    const cols = [
      { label: 'Name', w: 92 },
      { label: 'College', w: 78 },
      { label: 'Status', w: 74 },
      { label: 'Score', w: 52 },
      { label: '%', w: 42 },
      { label: 'Time', w: 58 },
      { label: 'Tab', w: 32 },
      { label: 'Cam', w: 32 },
      { label: 'FS', w: 32 },
    ];
    const startX = P.margin;
    let y = doc.y;

    function drawHeader() {
      doc.rect(startX, y, contentW, 16).fill('#1B2A4A');
      let x = startX;
      cols.forEach((c) => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF')
          .text(c.label, x + 4, y + 4.5, { width: c.w - 4, height: 10 });
        x += c.w;
      });
      y += 16;
    }
    function drawRow(attempt, rowIndex) {
      if (y > 760) { doc.addPage(); y = doc.y; drawHeader(); }
      if (rowIndex % 2 === 0) doc.rect(startX, y, contentW, 15).fill('#F2F4F8');
      let x = startX;
      const values = [
        attempt.student_name,
        attempt.register_number,
        STATUS_LABELS[attempt.display_status] || attempt.status,
        attempt.score !== null ? `${attempt.score}/${attempt.total_marks}` : '-',
        attempt.percentage !== null ? `${attempt.percentage}%` : '-',
        formatTimeTaken(attempt.time_taken_seconds),
        String(attempt.tab_switch_count ?? 0),
        String(attempt.webcam_violation_count ?? 0),
        String(attempt.fullscreen_violation_count ?? 0),
      ];
      values.forEach((v, i) => {
        doc.font('Helvetica').fontSize(7.5).fillColor('#333333')
          .text(String(v), x + 4, y + 3.5, { width: cols[i].w - 4, height: 11, ellipsis: true });
        x += cols[i].w;
      });
      y += 15;
    }

    drawHeader();
    if (attempts.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text('No attempts yet.', startX, y);
    } else {
      attempts.forEach((a, i) => drawRow(a, i));
    }

    doc.end();
  });
}

module.exports = { buildCsv, buildXlsx, buildPdf };

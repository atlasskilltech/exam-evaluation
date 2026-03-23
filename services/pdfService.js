const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateResultInvoice(evaluation, student, exam, subject) {
  return new Promise((resolve, reject) => {
    const dir = path.join('uploads', 'invoices');
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${student._id}_${evaluation._id}.pdf`;
    const filePath = path.join(dir, fileName);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('AI-Powered Evaluation System', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Result Invoice', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Student info
    const studentName = student.userId?.name || 'N/A';
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Student Name: ${studentName}`, 50);
    doc.text(`Roll No: ${student.rollNo}`);
    doc.text(`Class: ${student.className || 'N/A'} | Section: ${student.section || 'N/A'}`);
    doc.text(`Exam: ${exam.name} | Date: ${new Date(exam.date).toLocaleDateString()}`);
    doc.text(`Subject: ${subject.name}`);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    const colWidths = [50, 120, 120, 80, 50, 60];
    const headers = ['Q.No', 'Student Ans', 'Correct Ans', 'Marks', 'Max', 'Status'];

    doc.fontSize(10).font('Helvetica-Bold');
    let xPos = 50;
    headers.forEach((h, i) => {
      doc.text(h, xPos, tableTop, { width: colWidths[i], align: 'left' });
      xPos += colWidths[i];
    });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    // Table rows
    doc.font('Helvetica').fontSize(9);
    for (const q of evaluation.questionBreakdown) {
      const y = doc.y;
      if (y > 700) {
        doc.addPage();
      }
      xPos = 50;
      doc.text(String(q.qNo), xPos, doc.y, { width: colWidths[0], continued: false });
      const rowY = doc.y - 12;
      doc.text(q.studentAnswer || '-', xPos + colWidths[0], rowY, { width: colWidths[1] });
      doc.text(q.correctAnswer || '-', xPos + colWidths[0] + colWidths[1], rowY, { width: colWidths[2] });
      doc.text(String(q.marksAwarded), xPos + colWidths[0] + colWidths[1] + colWidths[2], rowY, { width: colWidths[3] });
      doc.text(String(q.maxMarks), xPos + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], rowY, { width: colWidths[4] });
      doc.text(q.isCorrect ? 'CORRECT' : 'WRONG', xPos + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], rowY, { width: colWidths[5] });
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Summary
    doc.fontSize(12).font('Helvetica-Bold');
    const totalMaxMarks = evaluation.questionBreakdown.reduce((s, q) => s + q.maxMarks, 0);
    doc.text(`Total Marks Obtained: ${evaluation.totalMarks} / ${totalMaxMarks}`);
    doc.text(`Percentage: ${evaluation.percentage}%`);
    doc.text(`Grade: ${evaluation.grade}`);
    doc.text(`Result: ${evaluation.passFail.toUpperCase()}`, {
      continued: false
    });

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica');
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 50);
    doc.text('Powered by AI Evaluation System', 50);
    doc.moveDown(2);
    doc.text('_________________________', 350);
    doc.text('Teacher Signature', 370);

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

function generateGradeSheet(student, exam, subjectResults, gradeSheet) {
  return new Promise((resolve, reject) => {
    const dir = path.join('uploads', 'gradesheets');
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${student._id}_${exam._id}.pdf`;
    const filePath = path.join(dir, fileName);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('OFFICIAL GRADE SHEET', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('AI-Powered Evaluation System', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#4338CA');
    doc.moveDown(0.5);

    // Student info
    const studentName = student.userId?.name || 'N/A';
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Student Name: ${studentName}`, 50);
    doc.text(`Roll No: ${student.rollNo}`);
    doc.text(`Class: ${student.className || 'N/A'} | Section: ${student.section || 'N/A'}`);
    doc.text(`Exam: ${exam.name}`);
    doc.text(`Date: ${new Date(exam.date).toLocaleDateString()}`);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Subjects table header
    const tableTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Sr', 50, tableTop, { width: 30 });
    doc.text('Subject', 80, tableTop, { width: 140 });
    doc.text('Obtained', 220, tableTop, { width: 70 });
    doc.text('Max', 290, tableTop, { width: 60 });
    doc.text('%', 350, tableTop, { width: 50 });
    doc.text('Grade', 400, tableTop, { width: 50 });
    doc.text('Status', 450, tableTop, { width: 70 });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    // Subject rows
    doc.font('Helvetica').fontSize(9);
    subjectResults.forEach((sr, idx) => {
      const y = doc.y;
      doc.text(String(idx + 1), 50, y, { width: 30 });
      doc.text(sr.subjectName, 80, y, { width: 140 });
      doc.text(String(sr.marksObtained), 220, y, { width: 70 });
      doc.text(String(sr.maxMarks), 290, y, { width: 60 });
      doc.text(String(sr.percentage) + '%', 350, y, { width: 50 });
      doc.text(sr.grade, 400, y, { width: 50 });
      doc.text(sr.passFail.toUpperCase(), 450, y, { width: 70 });
      doc.moveDown(0.8);
    });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Summary
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`Total: ${gradeSheet.totalMarks} / ${gradeSheet.totalMaxMarks}`);
    doc.text(`Overall Percentage: ${gradeSheet.overallPercentage}%`);
    doc.text(`Overall Grade: ${gradeSheet.overallGrade}`);
    doc.text(`Rank: ${gradeSheet.rank}`);
    doc.text(`Result: ${gradeSheet.passFail.toUpperCase()}`);

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica');
    doc.text('_________________________', 50);
    doc.text('Class Teacher', 80);
    doc.text('_________________________', 350);
    doc.text('Principal', 395);

    doc.moveDown(1);
    doc.text('[Official Stamp]', { align: 'center' });
    doc.moveDown(1);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 50);

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateResultInvoice, generateGradeSheet };

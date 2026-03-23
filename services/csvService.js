const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const Evaluation = require('../models/Evaluation');
const Student = require('../models/Student');
const User = require('../models/User');
const AnswerKey = require('../models/AnswerKey');
const CsvImport = require('../models/CsvImport');
const GradeSheet = require('../models/GradeSheet');

exports.exportResultsCsv = async (filter) => {
  const evaluations = await Evaluation.find(filter)
    .populate({
      path: 'studentId',
      populate: { path: 'userId', select: 'name' }
    })
    .populate('subjectId', 'name')
    .populate('examId', 'name');

  const data = evaluations.map(ev => ({
    rollNo: ev.studentId?.rollNo || '',
    studentName: ev.studentId?.userId?.name || '',
    className: ev.studentId?.className || '',
    subjectName: ev.subjectId?.name || '',
    totalMarks: ev.totalMarks,
    maxMarks: ev.questionBreakdown.reduce((s, q) => s + q.maxMarks, 0),
    percentage: ev.percentage,
    grade: ev.grade,
    passFail: ev.passFail,
    approvedAt: ev.approvedAt || ''
  }));

  const fields = ['rollNo', 'studentName', 'className', 'subjectName', 'totalMarks', 'maxMarks', 'percentage', 'grade', 'passFail', 'approvedAt'];
  const parser = new Parser({ fields });
  return parser.parse(data);
};

exports.exportResultsExcel = async (filter) => {
  const evaluations = await Evaluation.find(filter)
    .populate({
      path: 'studentId',
      populate: { path: 'userId', select: 'name' }
    })
    .populate('subjectId', 'name')
    .populate('examId', 'name');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');

  sheet.columns = [
    { header: 'Roll No', key: 'rollNo', width: 15 },
    { header: 'Student Name', key: 'studentName', width: 25 },
    { header: 'Class', key: 'className', width: 10 },
    { header: 'Subject', key: 'subjectName', width: 20 },
    { header: 'Marks Obtained', key: 'totalMarks', width: 15 },
    { header: 'Max Marks', key: 'maxMarks', width: 12 },
    { header: 'Percentage', key: 'percentage', width: 12 },
    { header: 'Grade', key: 'grade', width: 8 },
    { header: 'Result', key: 'passFail', width: 10 },
    { header: 'Approved At', key: 'approvedAt', width: 20 }
  ];

  // Style header row
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  for (const ev of evaluations) {
    const row = sheet.addRow({
      rollNo: ev.studentId?.rollNo || '',
      studentName: ev.studentId?.userId?.name || '',
      className: ev.studentId?.className || '',
      subjectName: ev.subjectId?.name || '',
      totalMarks: ev.totalMarks,
      maxMarks: ev.questionBreakdown.reduce((s, q) => s + q.maxMarks, 0),
      percentage: ev.percentage,
      grade: ev.grade,
      passFail: ev.passFail,
      approvedAt: ev.approvedAt ? new Date(ev.approvedAt).toLocaleDateString() : ''
    });

    // Conditional row formatting
    if (ev.passFail === 'pass') {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
      });
    } else if (ev.passFail === 'fail') {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
      });
    }
  }

  return workbook;
};

exports.importStudents = async (filePath, importedBy) => {
  const results = { total: 0, created: 0, updated: 0, errors: [] };

  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  results.total = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const { rollNo, name, email, className, section, phone, parentEmail } = row;

      if (!rollNo || !name || !email) {
        results.errors.push({ row: i + 1, field: 'required', message: 'rollNo, name, and email are required' });
        continue;
      }

      let user = await User.findOne({ email });
      if (!user) {
        const tempPassword = await bcrypt.hash('temp123456', 12);
        user = await User.create({ name, email, password: tempPassword, role: 'student', phone });
        results.created++;
      } else {
        user.name = name;
        if (phone) user.phone = phone;
        await user.save();
        results.updated++;
      }

      await Student.findOneAndUpdate(
        { rollNo },
        { userId: user._id, rollNo, className, section, parentEmail },
        { upsert: true, new: true }
      );
    } catch (err) {
      results.errors.push({ row: i + 1, field: 'unknown', message: err.message });
    }
  }

  // Log import
  await CsvImport.create({
    filePath,
    importedBy,
    recordCount: results.total,
    status: results.errors.length > 0 ? 'done' : 'done',
    errors: results.errors.map(e => `Row ${e.row}: ${e.message}`)
  });

  return results;
};

exports.importAnswerKey = async (filePath, subjectId) => {
  const questions = [];
  const errors = [];
  let rowNum = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowNum++;
        try {
          const q = {
            qNo: parseInt(row.qNo),
            correctAnswer: row.correctAnswer,
            maxMarks: parseFloat(row.maxMarks),
            acceptedVariants: row.acceptedVariants ? row.acceptedVariants.split('|').map(v => v.trim()) : []
          };
          if (!q.qNo || !q.correctAnswer || isNaN(q.maxMarks)) {
            errors.push({ row: rowNum, message: 'Missing required fields' });
          } else {
            questions.push(q);
          }
        } catch (e) {
          errors.push({ row: rowNum, message: e.message });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  if (questions.length > 0) {
    await AnswerKey.findOneAndUpdate(
      { subjectId },
      { subjectId, questions },
      { upsert: true, new: true }
    );
  }

  return { total: rowNum, success: questions.length, errors };
};

exports.pushToMCSE = async (examId) => {
  const gradeSheets = await GradeSheet.find({ examId, isPublished: true })
    .populate({
      path: 'studentId',
      populate: { path: 'userId', select: 'name' }
    })
    .populate('subjects.subjectId', 'name')
    .populate('examId', 'name date');

  const Exam = require('../models/Exam');
  const exam = await Exam.findById(examId);

  const payload = {
    exam: { id: examId, name: exam.name, date: exam.date },
    results: gradeSheets.map(gs => {
      const marks = {};
      gs.subjects.forEach(s => {
        if (s.subjectId) marks[s.subjectId.name] = s.marksObtained;
      });
      return {
        rollNo: gs.studentId?.rollNo,
        studentName: gs.studentId?.userId?.name,
        className: gs.studentId?.className,
        marks,
        total: gs.totalMarks,
        percentage: gs.overallPercentage,
        grade: gs.overallGrade,
        passFail: gs.passFail
      };
    })
  };

  const response = await axios.post(process.env.MCSE_API_URL, payload, {
    headers: { Authorization: `Bearer ${process.env.MCSE_API_KEY}` }
  });

  return {
    success: true,
    recordsPushed: payload.results.length,
    pushedAt: new Date(),
    mcseResponse: response.data
  };
};

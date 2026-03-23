const router = require('express').Router();
const path = require('path');
const { verifyToken, requireRole } = require('../middleware/auth');
const { generateResultInvoice, generateGradeSheet } = require('../services/pdfService');
const { calculateGrade } = require('../utils/helpers');
const Evaluation = require('../models/Evaluation');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const Subject = require('../models/Subject');
const ResultInvoice = require('../models/ResultInvoice');
const GradeSheet = require('../models/GradeSheet');
const ScanBatch = require('../models/ScanBatch');

// POST /api/results/invoice/:evalId
router.post('/invoice/:evalId', verifyToken, requireRole('superadmin', 'teacher', 'principal'), async (req, res, next) => {
  try {
    const evaluation = await Evaluation.findById(req.params.evalId)
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name email' }
      })
      .populate('examId')
      .populate('subjectId');

    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    const pdfPath = await generateResultInvoice(evaluation, evaluation.studentId, evaluation.examId, evaluation.subjectId);

    await ResultInvoice.findOneAndUpdate(
      { evaluationId: evaluation._id },
      {
        evaluationId: evaluation._id,
        studentId: evaluation.studentId._id,
        pdfPath,
        generatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      pdfPath,
      downloadUrl: `/api/results/invoice/${req.params.evalId}/download`
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/results/invoice/:evalId/download
router.get('/invoice/:evalId/download', verifyToken, async (req, res, next) => {
  try {
    const invoice = await ResultInvoice.findOne({ evaluationId: req.params.evalId });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found. Generate it first.' });
    }

    // Student can only download their own
    if (req.user.role === 'student') {
      const student = await Student.findOne({ userId: req.user.id });
      if (!student || student._id.toString() !== invoice.studentId.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }

    const fullPath = path.join(process.cwd(), invoice.pdfPath);
    res.download(fullPath);
  } catch (err) {
    next(err);
  }
});

// POST /api/results/gradesheet/:examId/:studentId
router.post('/gradesheet/:examId/:studentId', verifyToken, requireRole('superadmin', 'teacher', 'principal'), async (req, res, next) => {
  try {
    const { examId, studentId } = req.params;
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const student = await Student.findById(studentId).populate('userId', 'name email');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const evaluations = await Evaluation.find({
      examId, studentId, status: 'approved'
    }).populate('subjectId');

    if (evaluations.length === 0) {
      return res.status(400).json({ success: false, message: 'No approved evaluations found' });
    }

    const subjectResults = [];
    const subjects = [];
    let totalMarks = 0;
    let totalMaxMarks = 0;

    for (const ev of evaluations) {
      const maxMarks = ev.subjectId.totalQuestions * ev.subjectId.marksPerQuestion;
      const pct = maxMarks > 0 ? parseFloat(((ev.totalMarks / maxMarks) * 100).toFixed(2)) : 0;
      const grade = calculateGrade(pct, exam.gradingScale);

      subjectResults.push({
        subjectName: ev.subjectId.name,
        marksObtained: ev.totalMarks,
        maxMarks,
        percentage: pct,
        grade,
        passFail: ev.totalMarks >= exam.passingMarks ? 'pass' : 'fail'
      });

      subjects.push({
        subjectId: ev.subjectId._id,
        marksObtained: ev.totalMarks,
        maxMarks,
        grade
      });

      totalMarks += ev.totalMarks;
      totalMaxMarks += maxMarks;
    }

    const overallPercentage = totalMaxMarks > 0 ? parseFloat(((totalMarks / totalMaxMarks) * 100).toFixed(2)) : 0;
    const overallGrade = calculateGrade(overallPercentage, exam.gradingScale);
    const passFail = totalMarks >= exam.passingMarks ? 'pass' : 'fail';

    // Calculate rank
    const higherCount = await GradeSheet.countDocuments({
      examId, totalMarks: { $gt: totalMarks }
    });
    const rank = higherCount + 1;

    const gradeSheetData = {
      studentId, examId, subjects,
      totalMarks, totalMaxMarks, overallPercentage,
      overallGrade, rank, passFail
    };

    const pdfPath = await generateGradeSheet(student, exam, subjectResults, { ...gradeSheetData, rank });

    gradeSheetData.pdfPath = pdfPath;
    const gradeSheet = await GradeSheet.findOneAndUpdate(
      { studentId, examId },
      gradeSheetData,
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      pdfPath,
      downloadUrl: `/api/results/gradesheet/${examId}/${studentId}/download`
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/results/gradesheet/:examId/:studentId/download
router.get('/gradesheet/:examId/:studentId/download', verifyToken, async (req, res, next) => {
  try {
    const gradeSheet = await GradeSheet.findOne({
      examId: req.params.examId,
      studentId: req.params.studentId
    });

    if (!gradeSheet) {
      return res.status(404).json({ success: false, message: 'Grade sheet not found. Generate it first.' });
    }

    if (req.user.role === 'student') {
      const student = await Student.findOne({ userId: req.user.id });
      if (!student || student._id.toString() !== req.params.studentId) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }

    const fullPath = path.join(process.cwd(), gradeSheet.pdfPath);
    res.download(fullPath);
  } catch (err) {
    next(err);
  }
});

// POST /api/results/publish/:examId
router.post('/publish/:examId', verifyToken, requireRole('superadmin', 'principal'), async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const pendingBatches = await ScanBatch.countDocuments({
      examId: req.params.examId,
      status: { $nin: ['approved'] }
    });

    exam.status = 'published';
    await exam.save();

    await GradeSheet.updateMany(
      { examId: req.params.examId },
      { isPublished: true, publishedAt: new Date() }
    );

    // Send emails asynchronously
    const gradeSheets = await GradeSheet.find({ examId: req.params.examId })
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name email' }
      });

    let notifiedCount = 0;
    try {
      const { sendResultPublishedEmail } = require('../services/emailService');
      const results = await Promise.allSettled(
        gradeSheets.map(gs => {
          if (gs.studentId?.userId?.email) {
            return sendResultPublishedEmail(gs.studentId, exam, gs);
          }
          return Promise.resolve();
        })
      );
      notifiedCount = results.filter(r => r.status === 'fulfilled').length;
    } catch (e) {
      console.error('[EMAIL] Bulk send failed:', e.message);
    }

    res.json({
      success: true,
      published: true,
      studentsNotified: notifiedCount,
      publishedAt: new Date(),
      ...(pendingBatches > 0 && { warning: `${pendingBatches} batches are not yet approved` })
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/results/exam-results-screen/:examId
router.get('/exam-results-screen/:examId', verifyToken, async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const student = await Student.findOne({ userId: req.user.id });
      if (!student) {
        return res.status(404).json({ success: false, message: 'Student profile not found' });
      }

      const gradeSheet = await GradeSheet.findOne({
        examId: req.params.examId,
        studentId: student._id
      }).populate('subjects.subjectId', 'name');

      return res.json({ success: true, results: gradeSheet ? [gradeSheet] : [] });
    }

    // Admin/teacher/principal view
    const gradeSheets = await GradeSheet.find({ examId: req.params.examId })
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate('subjects.subjectId', 'name')
      .sort({ rank: 1 });

    // Analytics summary
    const totalStudents = gradeSheets.length;
    const passCount = gradeSheets.filter(g => g.passFail === 'pass').length;
    const marks = gradeSheets.map(g => g.totalMarks);

    res.json({
      success: true,
      results: gradeSheets,
      analytics: {
        avgMarks: totalStudents > 0 ? parseFloat((marks.reduce((a, b) => a + b, 0) / totalStudents).toFixed(2)) : 0,
        passRate: totalStudents > 0 ? parseFloat(((passCount / totalStudents) * 100).toFixed(2)) : 0,
        topScore: marks.length > 0 ? Math.max(...marks) : 0
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

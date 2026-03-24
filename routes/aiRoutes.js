const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken, requireRole } = require('../middleware/auth');
const { evaluateBatch, extractAnswerKeyFromPaper, fullEvaluate } = require('../services/aiService');
const QuickEvaluation = require('../models/QuickEvaluation');
const { calculateGrade } = require('../utils/helpers');
const ScanBatch = require('../models/ScanBatch');
const Evaluation = require('../models/Evaluation');
const Subject = require('../models/Subject');
const Exam = require('../models/Exam');
const AnswerKey = require('../models/AnswerKey');

// Multer config for question paper uploads
const qpStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/question-papers/';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const qpUpload = multer({
  storage: qpStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// POST /api/ai/evaluate/:batchId — Start AI evaluation (async)
router.post('/evaluate/:batchId', verifyToken, requireRole('superadmin', 'teacher'), async (req, res, next) => {
  try {
    const batch = await ScanBatch.findById(req.params.batchId);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    // Return 202 immediately
    res.status(202).json({ success: true, message: 'Evaluation started', batchId: batch._id });

    // Run evaluation asynchronously
    setImmediate(async () => {
      try {
        await evaluateBatch(req.params.batchId);
        console.log(`[AI] Evaluation complete for batch ${req.params.batchId}`);
      } catch (err) {
        console.error(`[AI] Evaluation failed for batch ${req.params.batchId}:`, err.message);
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/status/:batchId — Check evaluation status
router.get('/status/:batchId', verifyToken, async (req, res, next) => {
  try {
    const batch = await ScanBatch.findById(req.params.batchId).select('status errorMessage');
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const result = { success: true, status: batch.status, errorMessage: batch.errorMessage };
    const evaluation = await Evaluation.findOne({ batchId: req.params.batchId }).select('_id');
    if (evaluation) {
      result.evaluationId = evaluation._id;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/result/:batchId — Get full evaluation result
router.get('/result/:batchId', verifyToken, async (req, res, next) => {
  try {
    const evaluation = await Evaluation.findOne({ batchId: req.params.batchId })
      .populate('studentId')
      .populate('examId', 'name date totalMarks passingMarks')
      .populate('subjectId', 'name code');

    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    res.json({ success: true, evaluation });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/extract-answer-key/:subjectId — Extract answer key from scanned question paper
router.post('/extract-answer-key/:subjectId', verifyToken, requireRole('superadmin', 'teacher'), qpUpload.array('images', 10), async (req, res, next) => {
  const uploadedFiles = req.files || [];
  try {
    const subject = await Subject.findById(req.params.subjectId).populate('examId');
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'At least 1 image of the question paper is required' });
    }

    const exam = await Exam.findById(subject.examId);
    const examType = exam ? exam.type : 'mixed';

    // Return 202 and process async
    res.status(202).json({
      success: true,
      message: 'Answer key extraction started. Poll status at /api/ai/extract-status/' + req.params.subjectId
    });

    setImmediate(async () => {
      try {
        const imagePaths = uploadedFiles
          .sort((a, b) => a.originalname.localeCompare(b.originalname))
          .map(f => path.join(process.cwd(), f.path));

        const aiResult = await extractAnswerKeyFromPaper(
          imagePaths,
          subject.totalQuestions,
          subject.marksPerQuestion,
          examType
        );

        // Convert AI result to AnswerKey format
        const questions = aiResult.questions.map(q => ({
          qNo: String(q.q_no || '').replace(/^Q\.?\s*/i, '').trim(),
          correctAnswer: q.correct_answer,
          maxMarks: q.max_marks || subject.marksPerQuestion,
          acceptedVariants: q.accepted_variants || []
        }));

        await AnswerKey.findOneAndUpdate(
          { subjectId: subject._id },
          {
            subjectId: subject._id,
            questions,
            _extractionMeta: {
              source: 'question_paper_scan',
              confidence: aiResult.reading_confidence,
              extractedAt: new Date(),
              extractedBy: req.user.id,
              notes: aiResult.notes
            }
          },
          { upsert: true, new: true }
        );

        console.log(`[AI] Answer key extracted for subject ${req.params.subjectId}: ${questions.length} questions`);
      } catch (err) {
        console.error(`[AI] Answer key extraction failed for subject ${req.params.subjectId}:`, err.message);
        // Store error in a temp key so frontend can poll it
        await AnswerKey.findOneAndUpdate(
          { subjectId: req.params.subjectId },
          { _extractionError: err.message },
          { upsert: true }
        );
      } finally {
        // Clean up uploaded files
        for (const f of uploadedFiles) {
          try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
        }
      }
    });
  } catch (err) {
    // Clean up on error
    for (const f of uploadedFiles) {
      try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
    }
    next(err);
  }
});

// GET /api/ai/extract-status/:subjectId — Check if answer key extraction is done
router.get('/extract-status/:subjectId', verifyToken, async (req, res, next) => {
  try {
    const answerKey = await AnswerKey.findOne({ subjectId: req.params.subjectId });
    if (!answerKey) {
      return res.json({ success: true, status: 'processing' });
    }

    if (answerKey._extractionError) {
      return res.json({ success: true, status: 'failed', error: answerKey._extractionError });
    }

    if (answerKey.questions && answerKey.questions.length > 0) {
      return res.json({
        success: true,
        status: 'completed',
        questionCount: answerKey.questions.length,
        confidence: answerKey._extractionMeta?.confidence,
        notes: answerKey._extractionMeta?.notes,
        answerKey
      });
    }

    return res.json({ success: true, status: 'processing' });
  } catch (err) {
    next(err);
  }
});

// ── Full Evaluate: Question Paper + Answer Sheet combined ────────

// Multer for full evaluation (question paper + answer sheet)
const feStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'questionPaper'
      ? 'uploads/full-eval/question-papers/'
      : 'uploads/full-eval/answer-sheets/';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const feUpload = multer({
  storage: feStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// POST /api/ai/full-evaluate — Upload question paper + answer sheets and evaluate
router.post('/full-evaluate',
  verifyToken,
  requireRole('superadmin', 'teacher'),
  feUpload.fields([
    { name: 'questionPaper', maxCount: 10 },
    { name: 'answerSheet', maxCount: 20 }
  ]),
  async (req, res, next) => {
    const qpFiles = (req.files && req.files.questionPaper) || [];
    const asFiles = (req.files && req.files.answerSheet) || [];

    try {
      const { studentName, courseName, courseCode, examType } = req.body;

      if (!studentName) {
        return res.status(400).json({ success: false, message: 'Student name is required' });
      }
      if (qpFiles.length === 0) {
        return res.status(400).json({ success: false, message: 'At least 1 question paper image is required' });
      }
      if (asFiles.length === 0) {
        return res.status(400).json({ success: false, message: 'At least 1 answer sheet image is required' });
      }

      // Create the quick evaluation record
      const quickEval = await QuickEvaluation.create({
        studentName,
        courseName: courseName || '',
        courseCode: courseCode || '',
        examType: examType || 'descriptive',
        questionPaperImages: qpFiles.map(f => f.path),
        answerSheetImages: asFiles.map(f => f.path),
        status: 'extracting_questions',
        createdBy: req.user.id
      });

      // Return 202 immediately, process async
      res.status(202).json({
        success: true,
        message: 'Full evaluation started',
        evaluationId: quickEval._id
      });

      // Async processing
      setImmediate(async () => {
        try {
          const qpPaths = qpFiles.sort((a, b) => a.originalname.localeCompare(b.originalname))
            .map(f => path.join(process.cwd(), f.path));
          const asPaths = asFiles.sort((a, b) => a.originalname.localeCompare(b.originalname))
            .map(f => path.join(process.cwd(), f.path));

          quickEval.status = 'extracting_questions';
          await quickEval.save();

          const result = await fullEvaluate(qpPaths, asPaths, examType || 'descriptive');

          // Helper: normalize q_no to string (handles "Q.1", "Q1", "1a", 1)
          const parseQNo = (val) => {
            if (val == null) return '';
            return String(val).replace(/^Q\.?\s*/i, '').trim();
          };

          // Store extracted questions
          quickEval.extractedQuestions = result.extractedQuestions.map((q, i) => ({
            qNo: parseQNo(q.q_no) || String(i + 1),
            questionText: q.question_text,
            correctAnswer: q.correct_answer,
            maxMarks: parseFloat(q.max_marks) || 0,
            acceptedVariants: q.accepted_variants || [],
            confidence: q.confidence
          }));

          // Store evaluation breakdown
          const evaluation = result.evaluation;
          quickEval.questionBreakdown = evaluation.student_answers.map((sa, i) => ({
            qNo: parseQNo(sa.q_no) || String(i + 1),
            questionText: sa.question_text || '',
            studentAnswer: sa.student_answer,
            correctAnswer: sa.correct_answer,
            marksAwarded: parseFloat(sa.marks_awarded) || 0,
            maxMarks: parseFloat(sa.max_marks) || 0,
            isCorrect: sa.is_correct,
            aiConfidence: sa.ai_confidence,
            notes: sa.notes || ''
          }));

          quickEval.totalMarksObtained = evaluation.total_marks_obtained;
          quickEval.totalMaxMarksCalc = evaluation.total_max_marks;
          quickEval.percentage = evaluation.percentage;
          quickEval.grade = calculateGrade(evaluation.percentage);
          quickEval.passFail = evaluation.percentage >= 33 ? 'pass' : 'fail';
          quickEval.remarks = evaluation.remarks;
          quickEval.status = 'completed';
          await quickEval.save();

          console.log(`[AI] Full evaluation complete: ${quickEval._id} — ${evaluation.total_marks_obtained}/${evaluation.total_max_marks}`);
        } catch (err) {
          console.error(`[AI] Full evaluation failed: ${quickEval._id}:`, err.message);
          quickEval.status = 'failed';
          quickEval.errorMessage = err.message;
          await quickEval.save();
        }
      });
    } catch (err) {
      // Clean up uploaded files on error
      [...qpFiles, ...asFiles].forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
      });
      next(err);
    }
  }
);

// GET /api/ai/full-evaluate-status/:id — Poll status
router.get('/full-evaluate-status/:id', verifyToken, async (req, res, next) => {
  try {
    const quickEval = await QuickEvaluation.findById(req.params.id);
    if (!quickEval) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    res.json({
      success: true,
      status: quickEval.status,
      errorMessage: quickEval.errorMessage
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/full-evaluate-result/:id — Get full result
router.get('/full-evaluate-result/:id', verifyToken, async (req, res, next) => {
  try {
    const quickEval = await QuickEvaluation.findById(req.params.id);
    if (!quickEval) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    res.json({ success: true, evaluation: quickEval });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/full-evaluations — List all quick evaluations
router.get('/full-evaluations', verifyToken, async (req, res, next) => {
  try {
    const evaluations = await QuickEvaluation.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 })
      .select('studentName courseName courseCode status totalMarksObtained totalMaxMarksCalc percentage grade passFail createdAt');

    res.json({ success: true, evaluations });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

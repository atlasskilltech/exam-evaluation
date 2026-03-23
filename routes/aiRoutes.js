const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken, requireRole } = require('../middleware/auth');
const { evaluateBatch, extractAnswerKeyFromPaper } = require('../services/aiService');
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
          qNo: q.q_no,
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

module.exports = router;

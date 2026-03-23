const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { evaluateBatch } = require('../services/aiService');
const ScanBatch = require('../models/ScanBatch');
const Evaluation = require('../models/Evaluation');

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

module.exports = router;

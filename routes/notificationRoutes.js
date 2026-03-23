const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const Notification = require('../models/Notification');
const GradeSheet = require('../models/GradeSheet');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const { sendResultPublishedEmail } = require('../services/emailService');

// GET /api/notifications/my
router.get('/my', verifyToken, async (req, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ sentAt: -1 })
      .limit(30);

    res.json({ success: true, notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/send-results/:examId
router.post('/send-results/:examId', verifyToken, requireRole('superadmin', 'principal'), async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const gradeSheets = await GradeSheet.find({ examId: req.params.examId })
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name email' }
      })
      .populate('subjects.subjectId', 'name');

    const results = await Promise.allSettled(
      gradeSheets.map(gs => {
        if (gs.studentId?.userId?.email) {
          return sendResultPublishedEmail(gs.studentId, exam, gs);
        }
        return Promise.resolve();
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');

    res.json({ success: true, sent, failed, errors });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

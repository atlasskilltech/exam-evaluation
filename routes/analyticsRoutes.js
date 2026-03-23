const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const analytics = require('../controllers/analyticsController');

router.get('/overview/:examId', verifyToken, requireRole('superadmin', 'principal', 'teacher'), analytics.overview);
router.get('/subject-performance/:examId', verifyToken, requireRole('superadmin', 'principal', 'teacher'), analytics.subjectPerformance);
router.get('/grade-distribution/:examId', verifyToken, requireRole('superadmin', 'principal', 'teacher'), analytics.gradeDistribution);
router.get('/top-performers/:examId', verifyToken, requireRole('superadmin', 'principal', 'teacher'), analytics.topPerformers);
router.get('/class-comparison', verifyToken, requireRole('superadmin', 'principal'), analytics.classComparison);
router.get('/teacher-activity', verifyToken, requireRole('superadmin'), analytics.teacherActivity);

module.exports = router;

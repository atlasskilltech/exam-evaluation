const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const review = require('../controllers/reviewController');

router.get('/evaluations', verifyToken, requireRole('superadmin', 'teacher', 'principal'), review.getEvaluations);
router.get('/evaluations/:evalId', verifyToken, requireRole('superadmin', 'teacher', 'principal'), review.getEvaluation);
router.post('/evaluations/:evalId/override', verifyToken, requireRole('superadmin', 'teacher'), review.overrideMarks);
router.post('/evaluations/:evalId/approve', verifyToken, requireRole('superadmin', 'teacher'), review.approveEvaluation);
router.post('/evaluations/bulk-approve', verifyToken, requireRole('superadmin', 'teacher'), review.bulkApprove);
router.post('/evaluations/:evalId/flag', verifyToken, requireRole('superadmin', 'teacher'), review.flagEvaluation);
router.get('/overrides/:evalId', verifyToken, review.getOverrides);

module.exports = router;

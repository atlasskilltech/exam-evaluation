const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const exam = require('../controllers/examController');
const upload = require('multer')({ dest: 'uploads/csv/' });

router.delete('/:subjectId', verifyToken, requireRole('superadmin', 'teacher'), exam.deleteSubject);
router.post('/:subjectId/answer-key', verifyToken, requireRole('superadmin', 'teacher'), exam.upsertAnswerKey);
router.get('/:subjectId/answer-key', verifyToken, exam.getAnswerKey);
router.post('/:subjectId/answer-key/import-csv', verifyToken, requireRole('superadmin', 'teacher'), upload.single('file'), exam.importAnswerKeyCsv);

module.exports = router;

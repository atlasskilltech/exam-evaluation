const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const exam = require('../controllers/examController');
const upload = require('multer')({ dest: 'uploads/csv/' });

router.post('/', verifyToken, requireRole('superadmin', 'teacher'), exam.createExam);
router.get('/', verifyToken, exam.getExams);
router.get('/:id', verifyToken, exam.getExam);
router.put('/:id', verifyToken, requireRole('superadmin', 'teacher'), exam.updateExam);
router.delete('/:id', verifyToken, requireRole('superadmin'), exam.deleteExam);

// Subject routes nested under exams
router.post('/:examId/subjects', verifyToken, requireRole('superadmin', 'teacher'), exam.createSubject);
router.get('/:examId/subjects', verifyToken, exam.getSubjects);

module.exports = router;

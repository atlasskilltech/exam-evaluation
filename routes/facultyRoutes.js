const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const pdfUpload = require('../middleware/pdfUpload');
const fc = require('../controllers/facultyController');

// ── Faculty Management (admin only) ─────────────────────────
router.get('/list', verifyToken, requireRole('superadmin', 'teacher'), fc.listFaculty);
router.post('/create', verifyToken, requireRole('superadmin', 'teacher'), fc.createFaculty);

// ── Faculty-Subject Mapping (admin only) ────────────────────
router.post('/mapping', verifyToken, requireRole('superadmin', 'teacher'), fc.mapFacultyToSubject);
router.get('/mappings', verifyToken, requireRole('superadmin', 'teacher', 'faculty'), fc.getFacultyMappings);
router.delete('/mapping/:id', verifyToken, requireRole('superadmin', 'teacher'), fc.removeFacultyMapping);

// ── Question Paper Config (admin) ───────────────────────────
router.post('/question-paper',
  verifyToken,
  requireRole('superadmin', 'teacher', 'faculty'),
  (req, res, next) => { req.uploadType = 'question-papers'; next(); },
  pdfUpload.fields([
    { name: 'questionPaperPdf', maxCount: 1 },
    { name: 'answerKeyPdf', maxCount: 1 }
  ]),
  fc.upsertQuestionPaper
);
router.get('/question-paper/:examId/:subjectId', verifyToken, fc.getQuestionPaper);
router.post('/generate-rubrics',
  verifyToken,
  requireRole('superadmin', 'teacher', 'faculty'),
  (req, res, next) => { req.uploadType = 'question-papers'; next(); },
  pdfUpload.fields([{ name: 'questionPaperPdf', maxCount: 1 }]),
  fc.generateRubrics
);

// ── Student Paper Upload (admin) ────────────────────────────
router.post('/student-papers',
  verifyToken,
  requireRole('superadmin', 'teacher'),
  (req, res, next) => { req.uploadType = 'student-papers'; next(); },
  pdfUpload.fields([{ name: 'answerSheets', maxCount: 50 }]),
  fc.uploadStudentPapers
);
router.get('/student-papers', verifyToken, fc.getStudentPapers);
router.get('/student-paper/:id', verifyToken, fc.getStudentPaper);
router.post('/assign-paper', verifyToken, requireRole('superadmin', 'teacher'), fc.assignPaperToFaculty);
router.post('/bulk-assign', verifyToken, requireRole('superadmin', 'teacher'), fc.bulkAssignPapers);

// ── Faculty Evaluation ──────────────────────────────────────
router.get('/my-papers', verifyToken, requireRole('faculty'), fc.getFacultyAssignedPapers);
router.get('/evaluate/:paperId', verifyToken, requireRole('faculty'), fc.getEvaluationData);
router.post('/evaluate/:paperId', verifyToken, requireRole('faculty'), fc.saveEvaluation);
router.get('/page-image/:paperId/:pageNum', verifyToken, fc.getPageImage);
router.get('/page-count/:paperId', verifyToken, fc.getPageCount);
router.get('/annotated-evaluation/:evalId', verifyToken, fc.getAnnotatedEvaluation);
router.get('/evaluations/:examId', verifyToken, fc.getEvaluationsByExam);
router.post('/approve/:evalId', verifyToken, requireRole('superadmin', 'teacher'), fc.approveEvaluation);

// ── Faculty Dashboard ───────────────────────────────────────
router.get('/dashboard', verifyToken, requireRole('faculty'), fc.getFacultyDashboard);

module.exports = router;

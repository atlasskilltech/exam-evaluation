const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const csvService = require('../services/csvService');
const CsvImport = require('../models/CsvImport');
const upload = require('multer')({ dest: 'uploads/csv/' });
const fs = require('fs');

// GET /api/csv/export/results
router.get('/export/results', verifyToken, requireRole('superadmin', 'teacher', 'principal'), async (req, res, next) => {
  try {
    const filter = { status: 'approved' };
    if (req.query.examId) filter.examId = req.query.examId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;

    const csvData = await csvService.exportResultsCsv(filter);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=results_${req.query.examId || 'all'}_${Date.now()}.csv`);
    res.send(csvData);
  } catch (err) {
    next(err);
  }
});

// GET /api/csv/export/results/excel
router.get('/export/results/excel', verifyToken, requireRole('superadmin', 'teacher', 'principal'), async (req, res, next) => {
  try {
    const filter = { status: 'approved' };
    if (req.query.examId) filter.examId = req.query.examId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;

    const workbook = await csvService.exportResultsExcel(filter);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=results_${req.query.examId || 'all'}_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// POST /api/csv/import/students
router.post('/import/students', verifyToken, requireRole('superadmin', 'teacher'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
    }
    const result = await csvService.importStudents(req.file.path, req.user.id);

    // Cleanup
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/csv/import/answer-key
router.post('/import/answer-key', verifyToken, requireRole('superadmin', 'teacher'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
    }
    const { subjectId } = req.query;
    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'subjectId query param required' });
    }
    const result = await csvService.importAnswerKey(req.file.path, subjectId);

    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/csv/mcse/push/:examId
router.get('/mcse/push/:examId', verifyToken, requireRole('superadmin', 'principal'), async (req, res, next) => {
  try {
    const result = await csvService.pushToMCSE(req.params.examId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/csv/imports
router.get('/imports', verifyToken, requireRole('superadmin', 'teacher'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const total = await CsvImport.countDocuments();
    const imports = await CsvImport.find()
      .populate('importedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, imports, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

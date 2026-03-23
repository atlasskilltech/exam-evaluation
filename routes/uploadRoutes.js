const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/uploadController');

router.post('/scan-batch', verifyToken, requireRole('superadmin', 'teacher'), upload.array('images', 20), ctrl.uploadScanBatch);
router.get('/batches', verifyToken, requireRole('superadmin', 'teacher'), ctrl.getBatches);
router.get('/batches/:batchId', verifyToken, ctrl.getBatch);
router.delete('/batches/:batchId', verifyToken, requireRole('superadmin', 'teacher'), ctrl.deleteBatch);

module.exports = router;

const ScanBatch = require('../models/ScanBatch');
const Exam = require('../models/Exam');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Evaluation = require('../models/Evaluation');
const fs = require('fs');

exports.uploadScanBatch = async (req, res, next) => {
  try {
    const { examId, subjectId, studentId } = req.body;

    const exam = await Exam.findById(examId);
    if (!exam || exam.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Exam not found or not active' });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject || subject.examId.toString() !== examId) {
      return res.status(400).json({ success: false, message: 'Subject not found or does not belong to this exam' });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(400).json({ success: false, message: 'Student not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'At least 1 image is required' });
    }

    const batchCode = 'BATCH-' + examId.toString().slice(-6) + '-' + Date.now();

    // Sort files by original name for page ordering
    const sortedFiles = req.files.sort((a, b) => a.originalname.localeCompare(b.originalname));

    const images = sortedFiles.map((file, idx) => ({
      imagePath: file.path,
      pageNumber: idx + 1,
      uploadedAt: new Date()
    }));

    const batch = await ScanBatch.create({
      examId,
      subjectId,
      studentId,
      uploadedBy: req.user.id,
      batchCode,
      images,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      batchId: batch._id,
      batchCode: batch.batchCode,
      imageCount: images.length,
      status: 'pending',
      uploadedAt: batch.createdAt
    });
  } catch (err) {
    next(err);
  }
};

exports.getBatches = async (req, res, next) => {
  try {
    const { examId, subjectId, status, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (examId) filter.examId = examId;
    if (subjectId) filter.subjectId = subjectId;
    if (status) filter.status = status;

    // Teachers can only see their own uploads unless superadmin
    if (req.user.role === 'teacher') {
      filter.uploadedBy = req.user.id;
    }

    const total = await ScanBatch.countDocuments(filter);
    const batches = await ScanBatch.find(filter)
      .populate('studentId', 'rollNo className section')
      .populate('examId', 'name')
      .populate('subjectId', 'name')
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Attach student name from User model
    const Student = require('../models/Student');
    const populatedBatches = await Promise.all(batches.map(async (batch) => {
      const batchObj = batch.toObject();
      if (batch.studentId) {
        const studentDoc = await Student.findById(batch.studentId._id).populate('userId', 'name');
        if (studentDoc && studentDoc.userId) {
          batchObj.studentName = studentDoc.userId.name;
        }
      }
      return batchObj;
    }));

    res.json({
      success: true,
      batches: populatedBatches,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    next(err);
  }
};

exports.getBatch = async (req, res, next) => {
  try {
    const batch = await ScanBatch.findById(req.params.batchId)
      .populate('studentId')
      .populate('examId')
      .populate('subjectId')
      .populate('uploadedBy', 'name email');

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const batchObj = batch.toObject();
    const evaluation = await Evaluation.findOne({ batchId: batch._id });
    if (evaluation) {
      batchObj.evaluationId = evaluation._id;
      batchObj.evaluationStatus = evaluation.status;
    }

    res.json({ success: true, batch: batchObj });
  } catch (err) {
    next(err);
  }
};

exports.deleteBatch = async (req, res, next) => {
  try {
    const batch = await ScanBatch.findById(req.params.batchId);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    if (batch.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Can only delete pending batches' });
    }

    // Delete image files from disk
    for (const img of batch.images) {
      try {
        if (fs.existsSync(img.imagePath)) {
          fs.unlinkSync(img.imagePath);
        }
      } catch (e) {
        console.error('Failed to delete file:', img.imagePath);
      }
    }

    await batch.deleteOne();
    res.json({ success: true, message: 'Batch deleted' });
  } catch (err) {
    next(err);
  }
};

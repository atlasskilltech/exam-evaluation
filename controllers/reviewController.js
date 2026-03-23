const Evaluation = require('../models/Evaluation');
const ManualOverride = require('../models/ManualOverride');
const ScanBatch = require('../models/ScanBatch');
const Student = require('../models/Student');
const { calculateGrade } = require('../utils/helpers');

exports.getEvaluations = async (req, res, next) => {
  try {
    const { examId, subjectId, status, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (examId) filter.examId = examId;
    if (subjectId) filter.subjectId = subjectId;
    if (status) filter.status = status;

    // Search by roll number or student name
    if (search) {
      const students = await Student.find({
        $or: [
          { rollNo: { $regex: search, $options: 'i' } }
        ]
      }).populate('userId', 'name');

      // Also search by name via User
      const User = require('../models/User');
      const users = await User.find({ name: { $regex: search, $options: 'i' }, role: 'student' });
      const studentsByName = await Student.find({ userId: { $in: users.map(u => u._id) } });

      const allStudentIds = [...new Set([
        ...students.map(s => s._id.toString()),
        ...studentsByName.map(s => s._id.toString())
      ])];

      filter.studentId = { $in: allStudentIds };
    }

    const total = await Evaluation.countDocuments(filter);
    const evaluations = await Evaluation.find(filter)
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate('subjectId', 'name')
      .populate('examId', 'name')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      evaluations,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    next(err);
  }
};

exports.getEvaluation = async (req, res, next) => {
  try {
    const evaluation = await Evaluation.findById(req.params.evalId)
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name email' }
      })
      .populate('examId')
      .populate('subjectId')
      .populate('batchId')
      .populate('approvedBy', 'name email');

    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    const overrides = await ManualOverride.find({ evaluationId: evaluation._id })
      .populate('overriddenBy', 'name email')
      .sort({ timestamp: -1 });

    res.json({ success: true, evaluation, overrides });
  } catch (err) {
    next(err);
  }
};

exports.overrideMarks = async (req, res, next) => {
  try {
    const { qNo, newMarks, reason } = req.body;
    const evaluation = await Evaluation.findById(req.params.evalId).populate('examId');

    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }
    if (evaluation.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Cannot override approved evaluation' });
    }

    const question = evaluation.questionBreakdown.find(q => q.qNo === qNo);
    if (!question) {
      return res.status(400).json({ success: false, message: `Question ${qNo} not found` });
    }

    if (newMarks < 0 || newMarks > question.maxMarks) {
      return res.status(400).json({ success: false, message: `Marks must be between 0 and ${question.maxMarks}` });
    }

    // Create override record
    await ManualOverride.create({
      evaluationId: evaluation._id,
      qNo,
      originalMarks: question.marksAwarded,
      newMarks,
      overriddenBy: req.user.id,
      reason
    });

    // Update question marks
    question.marksAwarded = newMarks;
    question.isCorrect = newMarks === question.maxMarks;

    // Recalculate totals
    const totalMaxMarks = evaluation.questionBreakdown.reduce((sum, q) => sum + q.maxMarks, 0);
    evaluation.totalMarks = evaluation.questionBreakdown.reduce((sum, q) => sum + q.marksAwarded, 0);
    evaluation.percentage = totalMaxMarks > 0 ? parseFloat(((evaluation.totalMarks / totalMaxMarks) * 100).toFixed(2)) : 0;
    evaluation.grade = calculateGrade(evaluation.percentage, evaluation.examId.gradingScale);
    evaluation.passFail = evaluation.totalMarks >= evaluation.examId.passingMarks ? 'pass' : 'fail';
    evaluation.status = 'teacher_modified';

    await evaluation.save();

    res.json({
      success: true,
      updatedEvaluation: {
        totalMarks: evaluation.totalMarks,
        percentage: evaluation.percentage,
        grade: evaluation.grade,
        passFail: evaluation.passFail
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.approveEvaluation = async (req, res, next) => {
  try {
    const evaluation = await Evaluation.findById(req.params.evalId);
    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    if (!['ai_evaluated', 'teacher_modified'].includes(evaluation.status)) {
      return res.status(400).json({ success: false, message: 'Evaluation cannot be approved in current state' });
    }

    evaluation.status = 'approved';
    evaluation.approvedBy = req.user.id;
    evaluation.approvedAt = new Date();
    await evaluation.save();

    await ScanBatch.findByIdAndUpdate(evaluation.batchId, { status: 'approved' });

    res.json({ success: true, message: 'Evaluation approved', approvedAt: evaluation.approvedAt });
  } catch (err) {
    next(err);
  }
};

exports.bulkApprove = async (req, res, next) => {
  try {
    const { evalIds } = req.body;
    if (!evalIds || !Array.isArray(evalIds)) {
      return res.status(400).json({ success: false, message: 'evalIds array required' });
    }

    const evaluations = await Evaluation.find({ _id: { $in: evalIds } });
    let approved = 0;
    let skipped = 0;

    for (const evaluation of evaluations) {
      if (evaluation.status === 'ai_evaluated') {
        evaluation.status = 'approved';
        evaluation.approvedBy = req.user.id;
        evaluation.approvedAt = new Date();
        await evaluation.save();
        await ScanBatch.findByIdAndUpdate(evaluation.batchId, { status: 'approved' });
        approved++;
      } else {
        skipped++;
      }
    }

    res.json({ success: true, approved, skipped, message: `${approved} approved, ${skipped} skipped` });
  } catch (err) {
    next(err);
  }
};

exports.flagEvaluation = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const evaluation = await Evaluation.findById(req.params.evalId);
    if (!evaluation) {
      return res.status(404).json({ success: false, message: 'Evaluation not found' });
    }

    evaluation.flagged = true;
    evaluation.flagReason = reason;
    await evaluation.save();

    res.json({ success: true, message: 'Evaluation flagged' });
  } catch (err) {
    next(err);
  }
};

exports.getOverrides = async (req, res, next) => {
  try {
    const overrides = await ManualOverride.find({ evaluationId: req.params.evalId })
      .populate('overriddenBy', 'name email')
      .sort({ timestamp: -1 });

    res.json({ success: true, overrides });
  } catch (err) {
    next(err);
  }
};

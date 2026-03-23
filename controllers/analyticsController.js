const mongoose = require('mongoose');
const Evaluation = require('../models/Evaluation');
const ScanBatch = require('../models/ScanBatch');
const GradeSheet = require('../models/GradeSheet');
const Student = require('../models/Student');
const ManualOverride = require('../models/ManualOverride');

exports.overview = async (req, res, next) => {
  try {
    const examId = new mongoose.Types.ObjectId(req.params.examId);

    const batchStats = await ScanBatch.aggregate([
      { $match: { examId } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        processing: { $sum: { $cond: [{ $eq: ['$status', 'processing'] }, 1, 0] } },
        evaluated: { $sum: { $cond: [{ $eq: ['$status', 'evaluated'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
      }}
    ]);

    const evalStats = await Evaluation.aggregate([
      { $match: { examId } },
      { $group: {
        _id: null,
        passCount: { $sum: { $cond: [{ $eq: ['$passFail', 'pass'] }, 1, 0] } },
        failCount: { $sum: { $cond: [{ $eq: ['$passFail', 'fail'] }, 1, 0] } },
        avgMarks: { $avg: '$percentage' },
        highestScore: { $max: '$totalMarks' },
        lowestScore: { $min: '$totalMarks' },
        totalEvaluated: { $sum: 1 }
      }}
    ]);

    const batch = batchStats[0] || { total: 0, pending: 0, processing: 0, evaluated: 0, approved: 0, failed: 0 };
    const eval_ = evalStats[0] || { passCount: 0, failCount: 0, avgMarks: 0, highestScore: 0, lowestScore: 0, totalEvaluated: 0 };

    res.json({
      success: true,
      totalStudents: batch.total,
      evaluated: eval_.totalEvaluated,
      approved: batch.approved,
      pending: batch.pending + batch.processing,
      failed: batch.failed,
      passCount: eval_.passCount,
      failCount: eval_.failCount,
      passRate: eval_.totalEvaluated > 0 ? parseFloat(((eval_.passCount / eval_.totalEvaluated) * 100).toFixed(2)) : 0,
      classAverage: parseFloat((eval_.avgMarks || 0).toFixed(2)),
      highestScore: eval_.highestScore || 0,
      lowestScore: eval_.lowestScore || 0
    });
  } catch (err) {
    next(err);
  }
};

exports.subjectPerformance = async (req, res, next) => {
  try {
    const examId = new mongoose.Types.ObjectId(req.params.examId);

    const results = await Evaluation.aggregate([
      { $match: { examId } },
      { $group: {
        _id: '$subjectId',
        avgMarks: { $avg: '$totalMarks' },
        avgPercentage: { $avg: '$percentage' },
        passCount: { $sum: { $cond: [{ $eq: ['$passFail', 'pass'] }, 1, 0] } },
        totalEvaluated: { $sum: 1 }
      }},
      { $lookup: {
        from: 'subjects',
        localField: '_id',
        foreignField: '_id',
        as: 'subject'
      }},
      { $unwind: '$subject' },
      { $project: {
        subjectName: '$subject.name',
        avgMarks: { $round: ['$avgMarks', 2] },
        maxMarks: { $multiply: ['$subject.totalQuestions', '$subject.marksPerQuestion'] },
        passRate: {
          $round: [{ $multiply: [{ $divide: ['$passCount', '$totalEvaluated'] }, 100] }, 2]
        },
        totalEvaluated: 1
      }}
    ]);

    res.json({ success: true, subjects: results });
  } catch (err) {
    next(err);
  }
};

exports.gradeDistribution = async (req, res, next) => {
  try {
    const examId = new mongoose.Types.ObjectId(req.params.examId);

    const results = await Evaluation.aggregate([
      { $match: { examId } },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { grade: '$_id', count: 1, _id: 0 } }
    ]);

    res.json({ success: true, distribution: results });
  } catch (err) {
    next(err);
  }
};

exports.topPerformers = async (req, res, next) => {
  try {
    const examId = new mongoose.Types.ObjectId(req.params.examId);
    const limit = parseInt(req.query.limit) || 10;

    const results = await Evaluation.find({ examId })
      .sort({ totalMarks: -1 })
      .limit(limit)
      .populate({
        path: 'studentId',
        populate: { path: 'userId', select: 'name' }
      });

    const performers = results.map((ev, idx) => ({
      rank: idx + 1,
      studentName: ev.studentId?.userId?.name || 'N/A',
      rollNo: ev.studentId?.rollNo || 'N/A',
      totalMarks: ev.totalMarks,
      percentage: ev.percentage,
      grade: ev.grade
    }));

    res.json({ success: true, topPerformers: performers });
  } catch (err) {
    next(err);
  }
};

exports.classComparison = async (req, res, next) => {
  try {
    const { examId, groupBy = 'class' } = req.query;
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId required' });
    }

    const gradeSheets = await GradeSheet.find({ examId: new mongoose.Types.ObjectId(examId) })
      .populate('studentId');

    const groups = {};
    for (const gs of gradeSheets) {
      const key = groupBy === 'section'
        ? (gs.studentId?.section || 'Unknown')
        : (gs.studentId?.className || 'Unknown');

      if (!groups[key]) {
        groups[key] = { totalMarks: 0, count: 0 };
      }
      groups[key].totalMarks += gs.totalMarks;
      groups[key].count++;
    }

    const comparison = Object.entries(groups).map(([group, data]) => ({
      group,
      avgMarks: parseFloat((data.totalMarks / data.count).toFixed(2)),
      studentCount: data.count
    }));

    res.json({ success: true, comparison });
  } catch (err) {
    next(err);
  }
};

exports.teacherActivity = async (req, res, next) => {
  try {
    const approvalStats = await Evaluation.aggregate([
      { $match: { approvedBy: { $exists: true, $ne: null } } },
      { $group: { _id: '$approvedBy', evaluationsApproved: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'teacher' } },
      { $unwind: '$teacher' },
      { $project: { teacherName: '$teacher.name', evaluationsApproved: 1, _id: 0 } }
    ]);

    const overrideStats = await ManualOverride.aggregate([
      { $group: { _id: '$overriddenBy', marksOverridden: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'teacher' } },
      { $unwind: '$teacher' },
      { $project: { teacherName: '$teacher.name', marksOverridden: 1, _id: 0 } }
    ]);

    // Merge stats
    const teacherMap = {};
    for (const a of approvalStats) {
      teacherMap[a.teacherName] = { teacherName: a.teacherName, evaluationsApproved: a.evaluationsApproved, marksOverridden: 0 };
    }
    for (const o of overrideStats) {
      if (teacherMap[o.teacherName]) {
        teacherMap[o.teacherName].marksOverridden = o.marksOverridden;
      } else {
        teacherMap[o.teacherName] = { teacherName: o.teacherName, evaluationsApproved: 0, marksOverridden: o.marksOverridden };
      }
    }

    res.json({ success: true, teachers: Object.values(teacherMap) });
  } catch (err) {
    next(err);
  }
};

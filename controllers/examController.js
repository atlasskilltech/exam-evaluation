const Exam = require('../models/Exam');
const Subject = require('../models/Subject');
const AnswerKey = require('../models/AnswerKey');
const ScanBatch = require('../models/ScanBatch');

exports.createExam = async (req, res, next) => {
  try {
    const { name, date, totalMarks, passingMarks, type, gradingScale } = req.body;
    const exam = await Exam.create({
      name, date, totalMarks, passingMarks, type, gradingScale,
      createdBy: req.user.id
    });
    res.status(201).json({ success: true, exam });
  } catch (err) {
    next(err);
  }
};

exports.getExams = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const total = await Exam.countDocuments(filter);
    const exams = await Exam.find(filter)
      .populate('subjects')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      exams,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    next(err);
  }
};

exports.getExam = async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('subjects')
      .populate('createdBy', 'name email');
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    res.json({ success: true, exam });
  } catch (err) {
    next(err);
  }
};

exports.updateExam = async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    if (['published', 'closed'].includes(exam.status)) {
      return res.status(400).json({ success: false, message: 'Cannot edit a published or closed exam' });
    }

    const { name, date, totalMarks, passingMarks, type, gradingScale, status } = req.body;
    if (name) exam.name = name;
    if (date) exam.date = date;
    if (totalMarks) exam.totalMarks = totalMarks;
    if (passingMarks) exam.passingMarks = passingMarks;
    if (type) exam.type = type;
    if (gradingScale) exam.gradingScale = gradingScale;
    if (status) exam.status = status;

    await exam.save();
    res.json({ success: true, exam });
  } catch (err) {
    next(err);
  }
};

exports.deleteExam = async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    if (exam.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Can only delete draft exams' });
    }

    const batchCount = await ScanBatch.countDocuments({ examId: exam._id });
    if (batchCount > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete exam with existing scan batches' });
    }

    await Subject.deleteMany({ examId: exam._id });
    await AnswerKey.deleteMany({ subjectId: { $in: exam.subjects } });
    await exam.deleteOne();

    res.json({ success: true, message: 'Exam deleted' });
  } catch (err) {
    next(err);
  }
};

// Subject endpoints
exports.createSubject = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const { name, code, totalQuestions, marksPerQuestion, negativeMarking, negativeMarkValue } = req.body;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const subject = await Subject.create({
      examId, name, code, totalQuestions, marksPerQuestion, negativeMarking, negativeMarkValue
    });

    exam.subjects.push(subject._id);
    await exam.save();

    res.status(201).json({ success: true, subject });
  } catch (err) {
    next(err);
  }
};

exports.getSubjects = async (req, res, next) => {
  try {
    const subjects = await Subject.find({ examId: req.params.examId });
    res.json({ success: true, subjects });
  } catch (err) {
    next(err);
  }
};

exports.deleteSubject = async (req, res, next) => {
  try {
    const subject = await Subject.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    const batchCount = await ScanBatch.countDocuments({ subjectId: subject._id });
    if (batchCount > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete subject with existing scan batches' });
    }

    await Exam.findByIdAndUpdate(subject.examId, { $pull: { subjects: subject._id } });
    await AnswerKey.deleteMany({ subjectId: subject._id });
    await subject.deleteOne();

    res.json({ success: true, message: 'Subject deleted' });
  } catch (err) {
    next(err);
  }
};

// Answer Key endpoints
exports.upsertAnswerKey = async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const { questions } = req.body;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (questions.length !== subject.totalQuestions) {
      return res.status(400).json({
        success: false,
        message: `Expected ${subject.totalQuestions} questions, got ${questions.length}`
      });
    }

    const answerKey = await AnswerKey.findOneAndUpdate(
      { subjectId },
      { subjectId, questions },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, answerKey });
  } catch (err) {
    next(err);
  }
};

exports.getAnswerKey = async (req, res, next) => {
  try {
    const answerKey = await AnswerKey.findOne({ subjectId: req.params.subjectId });
    if (!answerKey) {
      return res.status(404).json({ success: false, message: 'Answer key not found' });
    }
    res.json({ success: true, answerKey });
  } catch (err) {
    next(err);
  }
};

exports.importAnswerKeyCsv = async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
    }

    const csv = require('csv-parser');
    const fs = require('fs');
    const questions = [];
    const errors = [];
    let rowNum = 0;

    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          rowNum++;
          try {
            const q = {
              qNo: parseInt(row.qNo),
              correctAnswer: row.correctAnswer,
              maxMarks: parseFloat(row.maxMarks),
              acceptedVariants: row.acceptedVariants ? row.acceptedVariants.split('|').map(v => v.trim()) : []
            };
            if (!q.qNo || !q.correctAnswer || isNaN(q.maxMarks)) {
              errors.push({ row: rowNum, message: 'Missing required fields' });
            } else {
              questions.push(q);
            }
          } catch (e) {
            errors.push({ row: rowNum, message: e.message });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (questions.length > 0) {
      await AnswerKey.findOneAndUpdate(
        { subjectId },
        { subjectId, questions },
        { upsert: true, new: true }
      );
    }

    // Clean up uploaded CSV
    const fs2 = require('fs');
    fs2.unlinkSync(req.file.path);

    res.json({ success: true, total: rowNum, success_count: questions.length, errors });
  } catch (err) {
    next(err);
  }
};

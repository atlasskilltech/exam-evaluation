const FacultyMapping = require('../models/FacultyMapping');
const QuestionPaper = require('../models/QuestionPaper');
const StudentPaper = require('../models/StudentPaper');
const FacultyEvaluation = require('../models/FacultyEvaluation');
const User = require('../models/User');
const Exam = require('../models/Exam');
const Subject = require('../models/Subject');
const path = require('path');

// ── Faculty Management ──────────────────────────────────────

exports.listFaculty = async (req, res, next) => {
  try {
    const faculty = await User.find({ role: 'faculty', status: 'active' }).select('name email phone');
    res.json({ success: true, faculty });
  } catch (err) { next(err); }
};

exports.createFaculty = async (req, res, next) => {
  try {
    const bcrypt = require('bcryptjs');
    const { name, email, password, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed, role: 'faculty', phone });

    res.status(201).json({ success: true, faculty: { id: user._id, name: user.name, email: user.email, phone: user.phone } });
  } catch (err) { next(err); }
};

// ── Faculty-Subject Mapping ─────────────────────────────────

exports.mapFacultyToSubject = async (req, res, next) => {
  try {
    const { facultyId, examId, subjectId } = req.body;

    const faculty = await User.findOne({ _id: facultyId, role: 'faculty' });
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const subject = await Subject.findById(subjectId);
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    const mapping = await FacultyMapping.findOneAndUpdate(
      { facultyId, examId, subjectId },
      { facultyId, examId, subjectId, assignedBy: req.user.id },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, mapping });
  } catch (err) { next(err); }
};

exports.getFacultyMappings = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.examId) filter.examId = req.query.examId;
    if (req.query.facultyId) filter.facultyId = req.query.facultyId;

    const mappings = await FacultyMapping.find(filter)
      .populate('facultyId', 'name email')
      .populate('examId', 'name date')
      .populate('subjectId', 'name code');

    res.json({ success: true, mappings });
  } catch (err) { next(err); }
};

exports.removeFacultyMapping = async (req, res, next) => {
  try {
    const mapping = await FacultyMapping.findByIdAndDelete(req.params.id);
    if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
    res.json({ success: true, message: 'Mapping removed' });
  } catch (err) { next(err); }
};

// ── Question Paper Config ───────────────────────────────────

exports.upsertQuestionPaper = async (req, res, next) => {
  try {
    const { examId, subjectId, questions } = req.body;

    const parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
    const totalMarks = parsedQuestions.reduce((sum, q) => sum + (q.maxMarks || 0), 0);

    const updateData = {
      examId, subjectId,
      questions: parsedQuestions,
      totalMarks,
      createdBy: req.user.id
    };

    if (req.files) {
      if (req.files.questionPaperPdf && req.files.questionPaperPdf[0]) {
        updateData.questionPaperPdf = '/' + req.files.questionPaperPdf[0].path.replace(/\\/g, '/');
      }
      if (req.files.answerKeyPdf && req.files.answerKeyPdf[0]) {
        updateData.answerKeyPdf = '/' + req.files.answerKeyPdf[0].path.replace(/\\/g, '/');
      }
    }

    const qp = await QuestionPaper.findOneAndUpdate(
      { examId, subjectId },
      updateData,
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, questionPaper: qp });
  } catch (err) { next(err); }
};

exports.getQuestionPaper = async (req, res, next) => {
  try {
    const { examId, subjectId } = req.params;
    const qp = await QuestionPaper.findOne({ examId, subjectId })
      .populate('examId', 'name')
      .populate('subjectId', 'name code');

    if (!qp) return res.status(404).json({ success: false, message: 'Question paper config not found' });
    res.json({ success: true, questionPaper: qp });
  } catch (err) { next(err); }
};

// ── Student Paper Upload ────────────────────────────────────

exports.uploadStudentPapers = async (req, res, next) => {
  try {
    const { examId, subjectId } = req.body;
    const studentNames = req.body.studentNames ? (typeof req.body.studentNames === 'string' ? JSON.parse(req.body.studentNames) : req.body.studentNames) : [];
    const rollNos = req.body.rollNos ? (typeof req.body.rollNos === 'string' ? JSON.parse(req.body.rollNos) : req.body.rollNos) : [];

    if (!req.files || !req.files.answerSheets || req.files.answerSheets.length === 0) {
      return res.status(400).json({ success: false, message: 'No answer sheet files uploaded' });
    }

    const papers = [];
    for (let i = 0; i < req.files.answerSheets.length; i++) {
      const file = req.files.answerSheets[i];
      const paper = await StudentPaper.create({
        examId, subjectId,
        studentName: studentNames[i] || '',
        rollNo: rollNos[i] || '',
        answerSheetPdf: '/' + file.path.replace(/\\/g, '/'),
        uploadedBy: req.user.id
      });
      papers.push(paper);
    }

    res.status(201).json({ success: true, papers, count: papers.length });
  } catch (err) { next(err); }
};

exports.getStudentPapers = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.examId) filter.examId = req.query.examId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.status) filter.status = req.query.status;

    const papers = await StudentPaper.find(filter)
      .populate('examId', 'name')
      .populate('subjectId', 'name code')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, papers });
  } catch (err) { next(err); }
};

exports.getStudentPaper = async (req, res, next) => {
  try {
    const paper = await StudentPaper.findById(req.params.id)
      .populate('examId', 'name')
      .populate('subjectId', 'name code')
      .populate('assignedTo', 'name email');

    if (!paper) return res.status(404).json({ success: false, message: 'Student paper not found' });
    res.json({ success: true, paper });
  } catch (err) { next(err); }
};

exports.assignPaperToFaculty = async (req, res, next) => {
  try {
    const { paperId, facultyId } = req.body;

    const paper = await StudentPaper.findById(paperId);
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

    paper.assignedTo = facultyId;
    paper.status = 'assigned';
    await paper.save();

    res.json({ success: true, paper });
  } catch (err) { next(err); }
};

exports.bulkAssignPapers = async (req, res, next) => {
  try {
    const { examId, subjectId, facultyId } = req.body;

    const result = await StudentPaper.updateMany(
      { examId, subjectId, status: 'uploaded' },
      { assignedTo: facultyId, status: 'assigned' }
    );

    res.json({ success: true, message: `${result.modifiedCount} papers assigned`, count: result.modifiedCount });
  } catch (err) { next(err); }
};

// ── Faculty Evaluation ──────────────────────────────────────

exports.getFacultyAssignedPapers = async (req, res, next) => {
  try {
    const facultyId = req.user.id;
    const filter = { assignedTo: facultyId };
    if (req.query.examId) filter.examId = req.query.examId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.status) filter.status = req.query.status;

    const papers = await StudentPaper.find(filter)
      .populate('examId', 'name date')
      .populate('subjectId', 'name code')
      .sort({ createdAt: -1 });

    // Get evaluation status for each paper
    const paperIds = papers.map(p => p._id);
    const evaluations = await FacultyEvaluation.find({
      studentPaperId: { $in: paperIds },
      facultyId
    }).select('studentPaperId status totalMarks');

    const evalMap = {};
    evaluations.forEach(e => { evalMap[e.studentPaperId.toString()] = e; });

    const result = papers.map(p => {
      const pObj = p.toObject();
      pObj.evaluation = evalMap[p._id.toString()] || null;
      return pObj;
    });

    res.json({ success: true, papers: result });
  } catch (err) { next(err); }
};

exports.getEvaluationData = async (req, res, next) => {
  try {
    const { paperId } = req.params;
    const facultyId = req.user.id;

    const paper = await StudentPaper.findById(paperId)
      .populate('examId', 'name date totalMarks')
      .populate('subjectId', 'name code');

    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

    // Check assignment
    if (paper.assignedTo && paper.assignedTo.toString() !== facultyId) {
      return res.status(403).json({ success: false, message: 'This paper is not assigned to you' });
    }

    // Get question paper config
    const questionPaper = await QuestionPaper.findOne({
      examId: paper.examId._id,
      subjectId: paper.subjectId._id
    });

    // Get existing evaluation if any
    const evaluation = await FacultyEvaluation.findOne({
      studentPaperId: paperId,
      facultyId
    });

    res.json({
      success: true,
      paper,
      questionPaper,
      evaluation
    });
  } catch (err) { next(err); }
};

exports.saveEvaluation = async (req, res, next) => {
  try {
    const { paperId } = req.params;
    const facultyId = req.user.id;
    const { questionMarks, remarks, status, timeTaken } = req.body;

    const paper = await StudentPaper.findById(paperId);
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

    const totalMarks = questionMarks.reduce((sum, q) => sum + (q.marksAwarded || 0), 0);
    const maxTotalMarks = questionMarks.reduce((sum, q) => sum + (q.maxMarks || 0), 0);
    const percentage = maxTotalMarks > 0 ? Math.round((totalMarks / maxTotalMarks) * 10000) / 100 : 0;

    const evalStatus = status || 'draft';

    const evaluation = await FacultyEvaluation.findOneAndUpdate(
      { studentPaperId: paperId, facultyId },
      {
        studentPaperId: paperId,
        examId: paper.examId,
        subjectId: paper.subjectId,
        facultyId,
        questionMarks,
        totalMarks,
        maxTotalMarks,
        percentage,
        status: evalStatus,
        remarks: remarks || '',
        timeTaken: timeTaken || 0
      },
      { upsert: true, new: true, runValidators: true }
    );

    // Update paper status
    if (evalStatus === 'submitted') {
      paper.status = 'evaluated';
      await paper.save();
    } else {
      paper.status = 'evaluating';
      await paper.save();
    }

    res.json({ success: true, evaluation });
  } catch (err) { next(err); }
};

exports.getEvaluationsByExam = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const filter = { examId };
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.status) filter.status = req.query.status;

    const evaluations = await FacultyEvaluation.find(filter)
      .populate('studentPaperId', 'studentName rollNo')
      .populate('facultyId', 'name email')
      .populate('subjectId', 'name code')
      .sort({ createdAt: -1 });

    res.json({ success: true, evaluations });
  } catch (err) { next(err); }
};

exports.approveEvaluation = async (req, res, next) => {
  try {
    const evaluation = await FacultyEvaluation.findById(req.params.evalId);
    if (!evaluation) return res.status(404).json({ success: false, message: 'Evaluation not found' });

    evaluation.status = 'approved';
    await evaluation.save();

    await StudentPaper.findByIdAndUpdate(evaluation.studentPaperId, { status: 'approved' });

    res.json({ success: true, evaluation });
  } catch (err) { next(err); }
};

// ── Faculty Dashboard Stats ─────────────────────────────────

// ── Generate Rubrics from Question Paper PDF ────────────────

exports.generateRubrics = async (req, res, next) => {
  try {
    const { examId, subjectId } = req.body;

    // Check if a question paper PDF was uploaded in this request
    let pdfPath;
    if (req.files && req.files.questionPaperPdf && req.files.questionPaperPdf[0]) {
      pdfPath = req.files.questionPaperPdf[0].path;
    } else {
      // Try to use an existing uploaded question paper
      const existing = await QuestionPaper.findOne({ examId, subjectId });
      if (existing && existing.questionPaperPdf) {
        // Remove leading slash for fs path
        pdfPath = existing.questionPaperPdf.replace(/^\//, '');
      }
    }

    if (!pdfPath) {
      return res.status(400).json({ success: false, message: 'No question paper PDF found. Please upload a question paper first.' });
    }

    const absolutePath = path.isAbsolute(pdfPath) ? pdfPath : path.join(process.cwd(), pdfPath);

    const { generateRubricsFromPdf } = require('../services/aiService');
    const result = await generateRubricsFromPdf(absolutePath);

    // Map AI response to our question format
    const questions = result.questions.map((q, idx) => ({
      qNo: idx + 1,
      title: q.title || '',
      maxMarks: q.max_marks || 10,
      rubric: q.rubric || ''
    }));

    res.json({
      success: true,
      questions,
      totalMarks: result.total_marks || questions.reduce((s, q) => s + q.maxMarks, 0),
      paperSummary: result.paper_summary || '',
      confidence: result.confidence || 0
    });
  } catch (err) {
    console.error('generateRubrics error:', err.response?.data || err.message);
    next(err);
  }
};

exports.getFacultyDashboard = async (req, res, next) => {
  try {
    const facultyId = req.user.id;

    const [totalAssigned, pendingCount, evaluatedCount, approvedCount] = await Promise.all([
      StudentPaper.countDocuments({ assignedTo: facultyId }),
      StudentPaper.countDocuments({ assignedTo: facultyId, status: { $in: ['assigned', 'evaluating'] } }),
      FacultyEvaluation.countDocuments({ facultyId, status: 'submitted' }),
      FacultyEvaluation.countDocuments({ facultyId, status: 'approved' })
    ]);

    // Get assigned exams/subjects
    const mappings = await FacultyMapping.find({ facultyId })
      .populate('examId', 'name date status')
      .populate('subjectId', 'name code');

    res.json({
      success: true,
      stats: { totalAssigned, pending: pendingCount, evaluated: evaluatedCount, approved: approvedCount },
      mappings
    });
  } catch (err) { next(err); }
};

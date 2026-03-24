const mongoose = require('mongoose');

const questionMarkSchema = new mongoose.Schema({
  qNo:          { type: String, required: true },
  maxMarks:     { type: Number, required: true },
  marksAwarded: { type: Number, default: 0 },
  comment:      { type: String, default: '' }
}, { _id: false });

const facultyEvaluationSchema = new mongoose.Schema({
  studentPaperId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentPaper', required: true },
  examId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  facultyId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  questionMarks:  [questionMarkSchema],
  totalMarks:     { type: Number, default: 0 },
  maxTotalMarks:  { type: Number, default: 0 },
  percentage:     { type: Number, default: 0 },
  status:         { type: String, enum: ['draft', 'submitted', 'approved'], default: 'draft' },
  remarks:        { type: String, default: '' },
  timeTaken:      { type: Number, default: 0 }
}, { timestamps: true });

facultyEvaluationSchema.index({ studentPaperId: 1, facultyId: 1 }, { unique: true });

module.exports = mongoose.model('FacultyEvaluation', facultyEvaluationSchema);

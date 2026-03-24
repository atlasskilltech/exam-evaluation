const mongoose = require('mongoose');

const evaluationSchema = new mongoose.Schema({
  batchId:   { type: mongoose.Schema.Types.ObjectId, ref: 'ScanBatch', unique: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  examId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  aiResponseRaw: { type: mongoose.Schema.Types.Mixed },
  questionBreakdown: [{
    qNo:           { type: String },
    studentAnswer: { type: String },
    correctAnswer: { type: String },
    marksAwarded:  { type: Number },
    maxMarks:      { type: Number },
    isCorrect:     { type: Boolean },
    aiConfidence:  { type: Number }
  }],
  totalMarks:  { type: Number },
  percentage:  { type: Number },
  grade:       { type: String },
  passFail:    { type: String, enum: ['pass', 'fail'] },
  status:      { type: String, enum: ['ai_evaluated', 'teacher_modified', 'approved'], default: 'ai_evaluated' },
  remarks:     { type: String },
  evaluatedAt: { type: Date },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:  { type: Date },
  flagged:     { type: Boolean, default: false },
  flagReason:  { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Evaluation', evaluationSchema);

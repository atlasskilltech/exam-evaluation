const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  qNo:      { type: Number, required: true },
  title:    { type: String, default: '' },
  maxMarks: { type: Number, required: true },
  rubric:   { type: String, default: '' }
}, { _id: false });

const questionPaperSchema = new mongoose.Schema({
  examId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  questionPaperPdf: { type: String },
  answerKeyPdf:     { type: String },
  questions:        [questionSchema],
  totalMarks:       { type: Number, default: 0 },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

questionPaperSchema.index({ examId: 1, subjectId: 1 }, { unique: true });

module.exports = mongoose.model('QuestionPaper', questionPaperSchema);

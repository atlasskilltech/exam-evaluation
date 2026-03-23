const mongoose = require('mongoose');

const quickEvaluationSchema = new mongoose.Schema({
  // Basic info
  studentName:  { type: String, required: true },
  courseName:   { type: String },
  courseCode:    { type: String },
  examType:     { type: String, enum: ['mcq', 'descriptive', 'mixed'], default: 'descriptive' },
  totalMaxMarks: { type: Number },

  // Scanned files stored on disk
  questionPaperImages: [{ type: String }],   // file paths
  answerSheetImages:   [{ type: String }],   // file paths

  // AI-extracted data
  extractedQuestions: [{
    qNo:              { type: Number },
    questionText:     { type: String },
    correctAnswer:    { type: String },
    maxMarks:         { type: Number },
    acceptedVariants: [{ type: String }],
    confidence:       { type: Number }
  }],

  // Evaluation result
  questionBreakdown: [{
    qNo:           { type: Number },
    questionText:  { type: String },
    studentAnswer: { type: String },
    correctAnswer: { type: String },
    marksAwarded:  { type: Number },
    maxMarks:      { type: Number },
    isCorrect:     { type: Boolean },
    aiConfidence:  { type: Number },
    notes:         { type: String }
  }],

  totalMarksObtained: { type: Number },
  totalMaxMarksCalc:  { type: Number },
  percentage:         { type: Number },
  grade:              { type: String },
  passFail:           { type: String, enum: ['pass', 'fail', 'pending'], default: 'pending' },
  remarks:            { type: String },

  // Status tracking
  status: {
    type: String,
    enum: ['uploading', 'extracting_questions', 'evaluating_answers', 'completed', 'failed'],
    default: 'uploading'
  },
  errorMessage: { type: String },

  // Who initiated
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('QuickEvaluation', quickEvaluationSchema);

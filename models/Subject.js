const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  examId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  name:             { type: String, required: true },
  code:             { type: String },
  totalQuestions:   { type: Number, required: true },
  marksPerQuestion: { type: Number, required: true },
  negativeMarking:  { type: Boolean, default: false },
  negativeMarkValue: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Subject', subjectSchema);

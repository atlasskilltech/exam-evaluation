const mongoose = require('mongoose');

const answerKeySchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', unique: true },
  questions: [{
    qNo:              { type: String, required: true },
    correctAnswer:    { type: String, required: true },
    maxMarks:         { type: Number, required: true },
    acceptedVariants: [{ type: String }]
  }]
}, { timestamps: true });

module.exports = mongoose.model('AnswerKey', answerKeySchema);

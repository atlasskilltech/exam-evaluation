const mongoose = require('mongoose');

const studentPaperSchema = new mongoose.Schema({
  examId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentName:    { type: String, default: '' },
  rollNo:         { type: String, default: '' },
  answerSheetPdf: { type: String, required: true },
  totalPages:     { type: Number, default: 0 },
  status:         { type: String, enum: ['uploaded', 'assigned', 'evaluating', 'evaluated', 'approved'], default: 'uploaded' },
  assignedTo:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

studentPaperSchema.index({ examId: 1, subjectId: 1, rollNo: 1 });

module.exports = mongoose.model('StudentPaper', studentPaperSchema);

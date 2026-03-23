const mongoose = require('mongoose');

const scanBatchSchema = new mongoose.Schema({
  examId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  batchCode:  { type: String, unique: true },
  images: [{
    imagePath:  { type: String },
    pageNumber: { type: Number },
    uploadedAt: { type: Date, default: Date.now }
  }],
  status:       { type: String, enum: ['pending', 'processing', 'evaluated', 'approved', 'failed'], default: 'pending' },
  errorMessage: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ScanBatch', scanBatchSchema);

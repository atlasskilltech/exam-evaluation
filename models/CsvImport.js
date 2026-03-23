const mongoose = require('mongoose');

const csvImportSchema = new mongoose.Schema({
  examId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  filePath:    { type: String },
  importedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordCount: { type: Number },
  status:      { type: String, enum: ['processing', 'done', 'failed'] },
  errors:      [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('CsvImport', csvImportSchema);

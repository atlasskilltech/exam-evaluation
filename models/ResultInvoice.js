const mongoose = require('mongoose');

const resultInvoiceSchema = new mongoose.Schema({
  evaluationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evaluation' },
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  pdfPath:      { type: String },
  generatedAt:  { type: Date },
  sentAt:       { type: Date },
  sentTo:       { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ResultInvoice', resultInvoiceSchema);

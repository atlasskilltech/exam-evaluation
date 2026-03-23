const mongoose = require('mongoose');

const manualOverrideSchema = new mongoose.Schema({
  evaluationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Evaluation' },
  qNo:           { type: Number },
  originalMarks: { type: Number },
  newMarks:      { type: Number },
  overriddenBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reason:        { type: String, required: true },
  timestamp:     { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ManualOverride', manualOverrideSchema);

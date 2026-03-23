const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  date:         { type: Date, required: true },
  totalMarks:   { type: Number, required: true },
  passingMarks: { type: Number, required: true },
  type:         { type: String, enum: ['mcq', 'descriptive', 'mixed'], required: true },
  status:       { type: String, enum: ['draft', 'active', 'published', 'closed'], default: 'draft' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subjects:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
  gradingScale: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      A: { min: 80, max: 100 },
      B: { min: 60, max: 79 },
      C: { min: 45, max: 59 },
      D: { min: 33, max: 44 },
      F: { min: 0, max: 32 }
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);

const mongoose = require('mongoose');

const facultyMappingSchema = new mongoose.Schema({
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  examId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

facultyMappingSchema.index({ facultyId: 1, examId: 1, subjectId: 1 }, { unique: true });

module.exports = mongoose.model('FacultyMapping', facultyMappingSchema);

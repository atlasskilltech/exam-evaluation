const mongoose = require('mongoose');

const gradeSheetSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  examId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  subjects: [{
    subjectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    marksObtained: { type: Number },
    maxMarks:      { type: Number },
    grade:         { type: String }
  }],
  totalMarks:        { type: Number },
  totalMaxMarks:     { type: Number },
  overallPercentage: { type: Number },
  overallGrade:      { type: String },
  rank:              { type: Number },
  passFail:          { type: String, enum: ['pass', 'fail'] },
  pdfPath:           { type: String },
  isPublished:       { type: Boolean, default: false },
  publishedAt:       { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('GradeSheet', gradeSheetSchema);

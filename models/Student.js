const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  rollNo:      { type: String, unique: true, required: true },
  className:   { type: String },
  section:     { type: String },
  parentEmail: { type: String },
  parentPhone: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);

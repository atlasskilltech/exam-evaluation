const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:           { type: String, required: true },
  email:          { type: String, unique: true, required: true },
  password:       { type: String, required: true, select: false },
  role:           { type: String, enum: ['superadmin', 'teacher', 'student', 'principal'], default: 'student' },
  status:         { type: String, enum: ['active', 'inactive'], default: 'active' },
  phone:          { type: String },
  resetOtp:       { type: String, select: false },
  resetOtpExpiry: { type: Date, select: false }
}, { timestamps: true });

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

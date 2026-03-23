const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type:    { type: String, enum: ['email', 'sms'] },
  subject: { type: String },
  message: { type: String },
  sentAt:  { type: Date },
  status:  { type: String, enum: ['sent', 'failed', 'pending'] }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);

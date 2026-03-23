const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOtpEmail } = require('../services/emailService');
const crypto = require('crypto');

const signToken = (user) => {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed, role, phone });

    const token = signToken(user);

    res.status(201).json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
};

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Generic message to not expose user existence
    if (!user) {
      return res.json({ success: true, message: 'If the email exists, an OTP has been sent' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save({ validateModifiedOnly: true });

    try {
      await sendOtpEmail(user, otp);
    } catch (emailErr) {
      console.error('[EMAIL] OTP send failed:', emailErr.message);
    }

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({ email }).select('+resetOtp +resetOtpExpiry');
    if (!user || !user.resetOtp) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (user.resetOtpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    const isOtpValid = await bcrypt.compare(otp, user.resetOtp);
    if (!isOtpValid) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    await user.save({ validateModifiedOnly: true });

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    next(err);
  }
};

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Student = require('../models/Student');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Create superadmin
  const adminPassword = await bcrypt.hash('admin123456', 12);
  await User.findOneAndUpdate(
    { email: 'admin@school.edu' },
    { name: 'Super Admin', email: 'admin@school.edu', password: adminPassword, role: 'superadmin' },
    { upsert: true, new: true }
  );
  console.log('Superadmin created: admin@school.edu / admin123456');

  // Create teacher
  const teacherPassword = await bcrypt.hash('teacher123456', 12);
  await User.findOneAndUpdate(
    { email: 'teacher@school.edu' },
    { name: 'John Teacher', email: 'teacher@school.edu', password: teacherPassword, role: 'teacher' },
    { upsert: true, new: true }
  );
  console.log('Teacher created: teacher@school.edu / teacher123456');

  // Create principal
  const principalPassword = await bcrypt.hash('principal123456', 12);
  await User.findOneAndUpdate(
    { email: 'principal@school.edu' },
    { name: 'Jane Principal', email: 'principal@school.edu', password: principalPassword, role: 'principal' },
    { upsert: true, new: true }
  );
  console.log('Principal created: principal@school.edu / principal123456');

  // Create a sample student
  const studentPassword = await bcrypt.hash('student123456', 12);
  const studentUser = await User.findOneAndUpdate(
    { email: 'student@school.edu' },
    { name: 'Alice Student', email: 'student@school.edu', password: studentPassword, role: 'student' },
    { upsert: true, new: true }
  );

  await Student.findOneAndUpdate(
    { rollNo: 'STU001' },
    { userId: studentUser._id, rollNo: 'STU001', className: '10', section: 'A', parentEmail: 'parent@school.edu' },
    { upsert: true, new: true }
  );
  console.log('Student created: student@school.edu / student123456 (Roll: STU001)');

  await mongoose.disconnect();
  console.log('Seed complete!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

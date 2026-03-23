const nodemailer = require('nodemailer');
const Notification = require('../models/Notification');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function logNotification(userId, type, subject, message, status) {
  try {
    await Notification.create({
      userId, type, subject, message,
      sentAt: new Date(),
      status
    });
  } catch (err) {
    console.error('[NOTIFICATION] Failed to log:', err.message);
  }
}

async function sendResultPublishedEmail(student, exam, gradeSheet) {
  const studentName = student.userId?.name || 'Student';
  const email = student.userId?.email;
  if (!email) return;

  const subjectRows = (gradeSheet.subjects || []).map(s => {
    const subName = s.subjectId?.name || 'Subject';
    return `<tr><td style="padding:8px;border:1px solid #ddd">${subName}</td>
            <td style="padding:8px;border:1px solid #ddd">${s.marksObtained}</td>
            <td style="padding:8px;border:1px solid #ddd">${s.grade}</td></tr>`;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#4338CA">Results Published</h2>
      <p>Dear ${studentName},</p>
      <p>Your results for <strong>${exam.name}</strong> have been published.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#4338CA;color:white">
            <th style="padding:8px;border:1px solid #ddd">Subject</th>
            <th style="padding:8px;border:1px solid #ddd">Marks</th>
            <th style="padding:8px;border:1px solid #ddd">Grade</th>
          </tr>
        </thead>
        <tbody>${subjectRows}</tbody>
      </table>
      <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0">
        <p><strong>Total Marks:</strong> ${gradeSheet.totalMarks} / ${gradeSheet.totalMaxMarks}</p>
        <p><strong>Percentage:</strong> ${gradeSheet.overallPercentage}%</p>
        <p><strong>Grade:</strong> ${gradeSheet.overallGrade}</p>
        <p><strong>Result:</strong> <span style="color:${gradeSheet.passFail === 'pass' ? '#16a34a' : '#dc2626'};font-weight:bold">${gradeSheet.passFail.toUpperCase()}</span></p>
        <p><strong>Rank:</strong> ${gradeSheet.rank}</p>
      </div>
      <p style="color:#6b7280;font-size:12px">AI-Powered Evaluation System</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: `Your ${exam.name} Results Are Now Available`,
      html
    });
    await logNotification(student.userId._id, 'email', `Your ${exam.name} Results Are Now Available`, html, 'sent');
  } catch (err) {
    await logNotification(student.userId._id, 'email', `Your ${exam.name} Results Are Now Available`, html, 'failed');
    throw err;
  }
}

async function sendEvaluationCompleteEmail(teacher, batch, evaluation) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#4338CA">AI Evaluation Complete</h2>
      <p>Dear ${teacher.name},</p>
      <p>AI evaluation for batch <strong>${batch.batchCode}</strong> is complete.</p>
      <div style="background:#f3f4f6;padding:16px;border-radius:8px">
        <p><strong>Total Marks:</strong> ${evaluation.totalMarks}</p>
        <p><strong>Percentage:</strong> ${evaluation.percentage}%</p>
        <p><strong>Grade:</strong> ${evaluation.grade}</p>
      </div>
      <p>Please review the evaluation at your earliest convenience.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: teacher.email,
      subject: `AI Evaluation Complete — ${batch.batchCode}`,
      html
    });
    await logNotification(teacher._id, 'email', `AI Evaluation Complete — ${batch.batchCode}`, html, 'sent');
  } catch (err) {
    await logNotification(teacher._id, 'email', `AI Evaluation Complete — ${batch.batchCode}`, html, 'failed');
  }
}

async function sendOtpEmail(user, otp) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#4338CA">Password Reset OTP</h2>
      <p>Dear ${user.name},</p>
      <p>Your password reset OTP is:</p>
      <div style="background:#4338CA;color:white;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;border-radius:8px;margin:16px 0">
        ${otp}
      </div>
      <p style="color:#dc2626"><strong>This OTP expires in 10 minutes.</strong></p>
      <p style="color:#6b7280;font-size:12px">If you did not request this, please ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Password Reset OTP',
    html
  });
}

async function sendBatchFailedAlert(teacher, batch, errorMessage) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">AI Evaluation Failed</h2>
      <p>Dear ${teacher.name},</p>
      <p>AI evaluation for batch <strong>${batch.batchCode}</strong> has failed.</p>
      <div style="background:#fef2f2;padding:16px;border-radius:8px;border-left:4px solid #dc2626">
        <p><strong>Error:</strong> ${errorMessage}</p>
      </div>
      <p>Please retry the evaluation or contact support.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: teacher.email,
      subject: `AI Evaluation Failed — ${batch.batchCode}`,
      html
    });
    await logNotification(teacher._id, 'email', `AI Evaluation Failed — ${batch.batchCode}`, html, 'sent');
  } catch (err) {
    await logNotification(teacher._id, 'email', `AI Evaluation Failed — ${batch.batchCode}`, html, 'failed');
  }
}

module.exports = {
  sendResultPublishedEmail,
  sendEvaluationCompleteEmail,
  sendOtpEmail,
  sendBatchFailedAlert,
  logNotification
};

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ScanBatch = require('../models/ScanBatch');
const AnswerKey = require('../models/AnswerKey');
const Evaluation = require('../models/Evaluation');
const { calculateGrade } = require('../utils/helpers');

// STEP 1 — Image Preparation
async function prepareImages(imagePaths) {
  const contents = [];
  for (const imgPath of imagePaths) {
    const buffer = fs.readFileSync(imgPath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(imgPath).toLowerCase();
    let mediaType = 'image/jpeg';
    if (ext === '.png') mediaType = 'image/png';

    contents.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64
      }
    });
  }
  return contents;
}

// STEP 2 — Prompt Construction
function buildEvaluationPrompt(answerKey, examType, subjectName) {
  return `You are an expert answer sheet evaluator for academic examinations.

Subject: ${subjectName}
Exam Type: ${examType}  (mcq / descriptive / mixed)

ANSWER KEY:
${answerKey.questions.map(q =>
  `Q${q.qNo}: Correct Answer = "${q.correctAnswer}" | Max Marks = ${q.maxMarks}${
    q.acceptedVariants && q.acceptedVariants.length ? ` | Also accept: ${q.acceptedVariants.join(', ')}` : ''
  }`
).join('\n')}

INSTRUCTIONS:
1. Carefully read ALL provided images in the order given (they are pages of ONE answer sheet)
2. Identify each question number written by the student
3. Extract the student's handwritten answer for each question accurately
4. For MCQ type: Award full marks if answer matches correctAnswer OR any acceptedVariants (case-insensitive trim comparison)
5. For Descriptive type: Award partial marks proportional to keyword coverage, concept accuracy, and relevance
6. For Mixed type: Apply MCQ rules to MCQ questions and descriptive rules to descriptive questions
7. If a question is skipped or blank: marksAwarded = 0
8. ai_confidence: your confidence in reading that answer (0.0 = very unsure, 1.0 = certain)
9. reading_confidence: overall confidence in reading the entire sheet

CRITICAL: Return ONLY a valid JSON object. No markdown. No explanation. No code fences. Just raw JSON.

Required JSON format:
{
  "student_answers": [
    {
      "q_no": 1,
      "student_answer": "B",
      "correct_answer": "B",
      "marks_awarded": 1,
      "max_marks": 1,
      "is_correct": true,
      "ai_confidence": 0.95,
      "notes": ""
    }
  ],
  "total_marks_obtained": 22,
  "total_max_marks": 30,
  "percentage": 73.33,
  "remarks": "Good performance. Strong conceptual understanding shown in Q1-Q10.",
  "reading_confidence": 0.88
}`;
}

// STEP 3 — Claude Vision API Call
async function callClaudeVision(imageContents, promptText) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          { type: 'text', text: promptText }
        ]
      }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 120000
    }
  );

  let rawText = response.data.content[0].text;
  rawText = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.student_answers || !Array.isArray(parsed.student_answers)) {
    throw new Error('AI returned invalid format: missing student_answers array');
  }
  if (typeof parsed.total_marks_obtained !== 'number') {
    throw new Error('AI returned invalid format: missing total_marks_obtained');
  }

  return parsed;
}

// STEP 4 — Store Result
async function storeEvaluation(batchId, aiResult, exam, batch, gradingScale) {
  const grade = calculateGrade(aiResult.percentage, gradingScale);
  const passFail = aiResult.total_marks_obtained >= exam.passingMarks ? 'pass' : 'fail';

  const questionBreakdown = aiResult.student_answers.map(sa => ({
    qNo: sa.q_no,
    studentAnswer: sa.student_answer,
    correctAnswer: sa.correct_answer,
    marksAwarded: sa.marks_awarded,
    maxMarks: sa.max_marks,
    isCorrect: sa.is_correct,
    aiConfidence: sa.ai_confidence
  }));

  const evaluation = await Evaluation.create({
    batchId,
    studentId: batch.studentId,
    examId: batch.examId._id,
    subjectId: batch.subjectId._id,
    aiResponseRaw: aiResult,
    questionBreakdown,
    totalMarks: aiResult.total_marks_obtained,
    percentage: aiResult.percentage,
    grade,
    passFail,
    status: 'ai_evaluated',
    remarks: aiResult.remarks,
    evaluatedAt: new Date()
  });

  batch.status = 'evaluated';
  await batch.save();

  return evaluation._id;
}

// MAIN EXPORTED FUNCTION
async function evaluateBatch(batchId) {
  const batch = await ScanBatch.findById(batchId)
    .populate('examId')
    .populate('subjectId')
    .populate('studentId');

  if (!batch) {
    throw new Error('Batch not found');
  }

  if (!['pending', 'failed'].includes(batch.status)) {
    throw new Error(`Batch status is '${batch.status}', cannot evaluate`);
  }

  const answerKey = await AnswerKey.findOne({ subjectId: batch.subjectId._id });
  if (!answerKey) {
    throw new Error('Answer key not found for this subject');
  }

  // Mark as processing
  batch.status = 'processing';
  batch.errorMessage = undefined;
  await batch.save();

  try {
    // Sort images by page number
    const sortedImages = [...batch.images].sort((a, b) => a.pageNumber - b.pageNumber);
    const imagePaths = sortedImages.map(img => path.join(process.cwd(), img.imagePath));

    const imageContents = await prepareImages(imagePaths);
    const prompt = buildEvaluationPrompt(answerKey, batch.examId.type, batch.subjectId.name);
    const aiResult = await callClaudeVision(imageContents, prompt);
    const evaluationId = await storeEvaluation(batchId, aiResult, batch.examId, batch, batch.examId.gradingScale);

    return {
      evaluationId,
      totalMarks: aiResult.total_marks_obtained,
      percentage: aiResult.percentage,
      grade: calculateGrade(aiResult.percentage, batch.examId.gradingScale),
      passFail: aiResult.total_marks_obtained >= batch.examId.passingMarks ? 'pass' : 'fail',
      status: 'evaluated'
    };
  } catch (err) {
    batch.status = 'failed';
    batch.errorMessage = err.message;
    await batch.save();
    throw err;
  }
}

// ── Extract Answer Key from Question Paper ─────────────────
function buildAnswerKeyExtractionPrompt(totalQuestions, marksPerQuestion, examType) {
  return `You are an expert academic question paper analyzer.

You are given scanned images of a QUESTION PAPER (not an answer sheet).
Exam Type: ${examType} (mcq / descriptive / mixed)
Expected number of questions: ${totalQuestions}
Default marks per question: ${marksPerQuestion}

INSTRUCTIONS:
1. Carefully read ALL provided images in order (they are pages of ONE question paper)
2. Identify each question number, the question text, and the correct answer
3. For MCQ: Extract the correct option (A/B/C/D or the answer text)
4. For Descriptive: Extract the model/expected answer or key points
5. For each question, determine the marks (use the value printed on the paper, or default to ${marksPerQuestion})
6. Include common accepted variants of the answer (alternate spellings, abbreviations, etc.)
7. If a question is not clearly visible, still include it with your best reading and lower confidence

CRITICAL: Return ONLY a valid JSON object. No markdown. No explanation. No code fences. Just raw JSON.

Required JSON format:
{
  "questions": [
    {
      "q_no": 1,
      "question_text": "What is the capital of France?",
      "correct_answer": "Paris",
      "max_marks": ${marksPerQuestion},
      "accepted_variants": ["paris"],
      "confidence": 0.95
    }
  ],
  "total_questions_found": ${totalQuestions},
  "reading_confidence": 0.90,
  "notes": "Any observations about the paper quality or readability"
}`;
}

async function extractAnswerKeyFromPaper(imagePaths, totalQuestions, marksPerQuestion, examType) {
  const imageContents = await prepareImages(imagePaths);
  const prompt = buildAnswerKeyExtractionPrompt(totalQuestions, marksPerQuestion, examType);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          { type: 'text', text: prompt }
        ]
      }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 120000
    }
  );

  let rawText = response.data.content[0].text;
  rawText = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI returned invalid format: missing questions array');
  }

  return parsed;
}

module.exports = { evaluateBatch, prepareImages, buildEvaluationPrompt, callClaudeVision, extractAnswerKeyFromPaper };

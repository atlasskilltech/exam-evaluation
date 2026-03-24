const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ScanBatch = require('../models/ScanBatch');
const AnswerKey = require('../models/AnswerKey');
const Evaluation = require('../models/Evaluation');
const { calculateGrade } = require('../utils/helpers');

// STEP 1 — Image Preparation (OpenAI format)
async function prepareImages(imagePaths) {
  const contents = [];
  for (const imgPath of imagePaths) {
    const buffer = fs.readFileSync(imgPath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(imgPath).toLowerCase();
    let mediaType = 'image/jpeg';
    if (ext === '.png') mediaType = 'image/png';

    contents.push({
      type: 'image_url',
      image_url: {
        url: `data:${mediaType};base64,${base64}`,
        detail: 'high'
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
2. Identify each question number written by the student — including sub-parts (e.g., 1a, 1b, 2a, 2b). Use the EXACT q_no from the answer key above.
3. Extract the student's handwritten answer for each question/sub-question accurately
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
      "q_no": "1a",
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

// STEP 3 — OpenAI Vision API Call
async function callOpenAIVision(imageContents, promptText) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o',
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
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  );

  let rawText = response.data.choices[0].message.content;
  rawText = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(rawText);

  return parsed;
}

// STEP 4 — Store Result
async function storeEvaluation(batchId, aiResult, exam, batch, gradingScale) {
  const grade = calculateGrade(aiResult.percentage, gradingScale);
  const passFail = aiResult.total_marks_obtained >= exam.passingMarks ? 'pass' : 'fail';

  const questionBreakdown = aiResult.student_answers.map(sa => ({
    qNo: String(sa.q_no || '').replace(/^Q\.?\s*/i, '').trim(),
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
    const aiResult = await callOpenAIVision(imageContents, prompt);
    if (!aiResult.student_answers || !Array.isArray(aiResult.student_answers)) {
      throw new Error('AI returned invalid format: missing student_answers array');
    }
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
2. Identify the EXACT structure of the paper — sections, question numbers, and sub-parts (a, b, c, etc.)
3. Preserve the EXACT question numbering as printed. If Q1 has parts (a) and (b), create separate entries with q_no "1a", "1b"
4. For MCQ: Extract the correct option (A/B/C/D or the answer text)
5. For Descriptive: Extract the model/expected answer or key points
6. For each question/sub-part, determine the marks (use the value printed on the paper, or default to ${marksPerQuestion})
7. Include common accepted variants of the answer (alternate spellings, abbreviations, etc.)
8. If a question is not clearly visible, still include it with your best reading and lower confidence

CRITICAL: Return ONLY a valid JSON object. No markdown. No explanation. No code fences. Just raw JSON.

Required JSON format:
{
  "questions": [
    {
      "q_no": "1a",
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
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o',
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
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  );

  let rawText = response.data.choices[0].message.content;
  rawText = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI returned invalid format: missing questions array');
  }

  return parsed;
}

// ── Full Evaluation: Question Paper + Answer Sheet in one go ─────
function buildFullEvaluationPrompt(extractedQuestions, examType) {
  return `You are an expert answer sheet evaluator for academic examinations.

Exam Type: ${examType} (mcq / descriptive / mixed)

ANSWER KEY (extracted from the question paper):
${extractedQuestions.map(q =>
  `Q${q.q_no}: Question = "${q.question_text}" | Correct Answer = "${q.correct_answer}" | Max Marks = ${q.max_marks}${
    q.accepted_variants && q.accepted_variants.length ? ` | Also accept: ${q.accepted_variants.join(', ')}` : ''
  }`
).join('\n')}

INSTRUCTIONS:
1. Carefully read ALL provided images in the order given (they are pages of ONE student's answer sheet)
2. Identify each question number and sub-part written by the student. Use the EXACT q_no from the answer key above (e.g., "1a", "1b", "2a").
3. Extract the student's handwritten answer for each question/sub-question accurately
4. For MCQ type: Award full marks if answer matches correctAnswer OR any acceptedVariants (case-insensitive trim comparison)
5. For Descriptive type: Award partial marks proportional to keyword coverage, concept accuracy, relevance, and depth of explanation. Be fair and generous — if the student demonstrates understanding of the core concepts, award proportional marks even if wording differs from the model answer.
6. For Mixed type: Apply MCQ rules to MCQ questions and descriptive rules to descriptive questions
7. If a question is skipped or blank: marksAwarded = 0
8. ai_confidence: your confidence in reading that specific answer (0.0 = very unsure, 1.0 = certain)
9. reading_confidence: overall confidence in reading the entire sheet

CRITICAL: Return ONLY a valid JSON object. No markdown. No explanation. No code fences. Just raw JSON.

Required JSON format:
{
  "student_answers": [
    {
      "q_no": "1a",
      "question_text": "Brief question text",
      "student_answer": "The student's actual written answer (summarized if very long)",
      "correct_answer": "Expected answer",
      "marks_awarded": 3,
      "max_marks": 5,
      "is_correct": false,
      "ai_confidence": 0.85,
      "notes": "Partial marks — covered 2 out of 3 key concepts"
    }
  ],
  "total_marks_obtained": 22,
  "total_max_marks": 40,
  "percentage": 55.0,
  "remarks": "Overall assessment of the student's performance.",
  "reading_confidence": 0.88
}`;
}

async function fullEvaluate(questionPaperPaths, answerSheetPaths, examType = 'descriptive') {
  // Step 1: Extract questions from question paper
  const qpImageContents = await prepareImages(questionPaperPaths);
  const extractionPrompt = buildAnswerKeyExtractionPrompt(0, 0, examType)
    .replace('Expected number of questions: 0', 'Identify ALL questions from the paper')
    .replace('Default marks per question: 0', 'Read marks from the paper for each question');

  const extractedData = await callOpenAIVision(qpImageContents, extractionPrompt);

  if (!extractedData.questions || !Array.isArray(extractedData.questions)) {
    throw new Error('Failed to extract questions from question paper');
  }

  // Step 2: Evaluate answer sheet against extracted questions
  const asImageContents = await prepareImages(answerSheetPaths);
  const evalPrompt = buildFullEvaluationPrompt(extractedData.questions, examType);
  const evalResult = await callOpenAIVision(asImageContents, evalPrompt);

  if (!evalResult.student_answers || !Array.isArray(evalResult.student_answers)) {
    throw new Error('Failed to evaluate answer sheet');
  }

  return {
    extractedQuestions: extractedData.questions,
    extractionConfidence: extractedData.reading_confidence,
    extractionNotes: extractedData.notes,
    evaluation: evalResult
  };
}

// ── Generate Rubrics from Question Paper PDF ─────────────────
function buildRubricGenerationPrompt(pdfText) {
  return `You are an expert academic question paper analyzer and rubric designer.

You are given a question paper (either as extracted text or as an attached PDF image). Analyze it carefully.

QUESTION PAPER CONTENT:
---
${pdfText}
---

CRITICAL RULES — READ VERY CAREFULLY:

1. READ THE MARKS COLUMN: Every question paper has marks printed on the right side. You MUST read and use the EXACT marks printed for each question. Do NOT guess or redistribute marks.

2. FOLLOW THE EXACT PAPER STRUCTURE:
   - If a question has sub-parts (a, b, c) with SEPARATE marks printed for EACH sub-part → create SEPARATE entries for each sub-part (e.g., "1a", "1b")
   - If a question has sub-parts (a, b, c) but only ONE total mark is printed for the whole question → create ONE entry for the whole question (e.g., "1")
   - If a question has NO sub-parts → create ONE entry (e.g., "2")
   - NEVER split a question into sub-parts if the paper does NOT have sub-parts
   - NEVER merge sub-parts if they have separate marks printed

3. SECTION HANDLING:
   - Note any section instructions (e.g., "Answer any 3 out of 5") in the paper_summary
   - Include ALL questions from ALL sections — even optional ones
   - Use the question numbers as printed: Q.1, Q.2, Q.3, etc.

4. For each question/sub-part entry, provide:
   - q_no: The question number exactly as on paper. Use "1a", "1b" for sub-parts, or just "1", "2" for whole questions
   - title: Brief description of what the question asks
   - max_marks: The EXACT marks as printed on the paper for this specific question/sub-part
   - rubric: Detailed marking criteria for evaluating student answers, including:
     * Key concepts/points needed for full marks
     * How to distribute partial marks
     * Common mistakes to watch for

EXAMPLE 1 — Question WITH sub-parts having separate marks:
Paper shows: Q.1 (case study, 10 marks total)
  a) Identify challenges... [5 marks]
  b) Discuss importance... [5 marks]
→ Output: { "q_no": "1a", "max_marks": 5 }, { "q_no": "1b", "max_marks": 5 }

EXAMPLE 2 — Question WITHOUT sub-parts:
Paper shows: Q.3 Explain MVP concept... [10 marks]
→ Output: { "q_no": "3", "max_marks": 10 }

EXAMPLE 3 — Question with sub-parts but SINGLE total mark:
Paper shows: Q.6 What is MOAT? Choose 2 brands and discuss: a) Air Jordan b) D Mart c) Mama Earth d) Starbucks e) Maggi [10 marks]
→ Output: { "q_no": "6", "max_marks": 10 }  (the a/b/c/d/e are choices, NOT separate sub-questions)

CRITICAL: Return ONLY a valid JSON object. No markdown. No explanation. No code fences. Just raw JSON.

{
  "questions": [
    {
      "q_no": "1a",
      "title": "Brief description of what the question asks",
      "max_marks": 5,
      "rubric": "Detailed marking criteria..."
    }
  ],
  "total_questions": 7,
  "total_marks": 40,
  "paper_summary": "Subject, sections, special instructions (e.g. Section B: answer any 3 out of 5)",
  "confidence": 0.9
}`;
}

async function generateRubricsFromPdf(pdfFilePath) {
  const pdfBuffer = fs.readFileSync(pdfFilePath);
  let pdfText = '';

  // Try text extraction first
  try {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(pdfBuffer);
    if (pdfData.text && pdfData.text.trim().length >= 50) {
      pdfText = pdfData.text.substring(0, 15000);
    }
  } catch (e) { /* text extraction failed, will use vision */ }

  const prompt = buildRubricGenerationPrompt(pdfText || 'See the attached PDF document.');

  let messages;
  if (pdfText) {
    // Text-based: send as plain text prompt
    messages = [{ role: 'user', content: prompt }];
  } else {
    // Scanned/image PDF: send PDF as file content to OpenAI
    const base64Pdf = pdfBuffer.toString('base64');
    messages = [{
      role: 'user',
      content: [
        {
          type: 'file',
          file: {
            filename: 'question_paper.pdf',
            file_data: `data:application/pdf;base64,${base64Pdf}`
          }
        },
        { type: 'text', text: prompt }
      ]
    }];
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      max_tokens: 4096,
      messages
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    }
  );

  let rawText = response.data.choices[0].message.content;
  rawText = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(rawText);

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI returned invalid format: missing questions array');
  }

  return parsed;
}

module.exports = { evaluateBatch, prepareImages, buildEvaluationPrompt, callOpenAIVision, extractAnswerKeyFromPaper, fullEvaluate, generateRubricsFromPdf };

function calculateGrade(percentage, gradingScale) {
  if (!gradingScale) {
    gradingScale = {
      A: { min: 80, max: 100 },
      B: { min: 60, max: 79 },
      C: { min: 45, max: 59 },
      D: { min: 33, max: 44 },
      F: { min: 0, max: 32 }
    };
  }

  for (const [grade, range] of Object.entries(gradingScale)) {
    if (percentage >= range.min && percentage <= range.max) {
      return grade;
    }
  }
  return 'F';
}

module.exports = { calculateGrade };

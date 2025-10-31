// gradeUtils.js
module.exports = function getGrade(marks) {
  marks = Number(marks) || 0;
  if (marks >= 80) return { grade: "A+", gpa: 5.0 };
  if (marks >= 70) return { grade: "A",  gpa: 4.0 };
  if (marks >= 60) return { grade: "A-", gpa: 3.5 };
  if (marks >= 50) return { grade: "B",  gpa: 3.0 };
  if (marks >= 40) return { grade: "C",  gpa: 2.0 };
  if (marks >= 33) return { grade: "D",  gpa: 1.0 };
  return { grade: "F", gpa: 0.0 };
};

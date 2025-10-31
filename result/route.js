const express = require("express");
const router = express.Router();
const { User, Student, Result } = require("../model/schema");
const subjectsConfig = require("../config/subjectsConfig");
const getGrade = require("../config/gradeUtils");
const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.error("No token provided in Authorization header");
    return res.status(401).json({ message: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error("Token verification failed:", err.message);
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Middleware to check user role
const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        console.error(`User not found for ID: ${req.user.id}`);
        return res.status(404).json({ message: "User not found" });
      }

      if (!allowedRoles.includes(user.role)) {
        console.error(`Insufficient permissions for user: ${user.email}, role: ${user.role}`);
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      req.currentUser = user;
      next();
    } catch (err) {
      console.error("Role check error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  };
};

// ✅ Get subjects by class
router.get("/subjects/:className", authenticateToken, (req, res) => {
  const { className } = req.params;
  const subjects = subjectsConfig[className];

  if (!subjects) {
    return res.status(404).json({ message: "No subjects found for this class" });
  }

  res.json({ subjects });
});

// ✅ Get student results
router.get("/results/:studentId",  async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    const result = await Result.findOne({ student: studentId }).sort({ createdAt: -1 });
    if (!result) {
      return res.status(404).json({ message: "No results found for this student" });
    }
    res.status(200).json({
      student: {
        name: student.name,
        roll: student.roll,
        class: student.class,
        section: student.section,
      },
      results: {
        examType: result.examType,
        semester: result.semester,
        marks: result.marks,
        totalMcqMarks: result.totalMcqMarks,
        totalCqMarks: result.totalCqMarks,
        totalMarks: result.totalMarks,
        averageGPA: result.averageGPA,
      },
    });
  } catch (err) {
    console.error("Error fetching results:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Submit MCQ Result
router.post(
  "/submit/mcq",
  authenticateToken,
  requireRole(["teacher", "admin", "super_admin"]),
  async (req, res) => {
    try {
      const { studentId, className, classNumber, semester, marks } = req.body;
      const classKey = className || classNumber;

      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const validSubjects = subjectsConfig[classKey];
      if (!validSubjects) {
        return res.status(400).json({ message: `Invalid class: ${classKey}` });
      }

      // Format marks for MCQ system
      const formattedMarks = validSubjects.map((subject) => {
        const subjectMarks = marks[subject] || {};
        return {
          subject,
          mcqScore: subjectMarks.score || 0,
          mcqTotal: subjectMarks.total || 0,
          cqScore: 0,
          cqTotal: 0,
        };
      });

      const newResult = new Result({
        student: studentId,
        class: classKey,
        semester,
        examType: "mcq",
        marks: formattedMarks,
      });

      await newResult.save();

      res.status(201).json({
        message: "MCQ result submitted successfully",
        data: newResult,
      });
    } catch (err) {
      console.error("Submit MCQ result error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ✅ Submit CQ Result
router.post(
  "/submit/cq",
  authenticateToken,
  requireRole(["teacher", "admin", "super_admin"]),
  async (req, res) => {
    try {
      const { studentId, className, classNumber, semester, marks } = req.body;
      const classKey = className || classNumber;

      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const validSubjects = subjectsConfig[classKey];
      if (!validSubjects) {
        return res.status(400).json({ message: `Invalid class: ${classKey}` });
      }

      // Format marks for CQ system
      const formattedMarks = validSubjects.map((subject) => {
        const subjectMarks = marks[subject] || {};
        return {
          subject,
          mcqScore: 0,
          mcqTotal: 0,
          cqScore: subjectMarks.score || 0,
          cqTotal: subjectMarks.total || 0,
        };
      });

      const newResult = new Result({
        student: studentId,
        class: classKey,
        semester,
        examType: "cq",
        marks: formattedMarks,
      });

      await newResult.save();

      res.status(201).json({
        message: "CQ result submitted successfully",
        data: newResult,
      });
    } catch (err) {
      console.error("Submit CQ result error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ✅ Submit Combined Result (MCQ + CQ)
router.post(
  "/submit/combined",
  authenticateToken,
  requireRole(["teacher", "admin", "super_admin"]),
  async (req, res) => {
    try {
      const { studentId, className, classNumber, semester, marks } = req.body;
      const classKey = className || classNumber;


      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const validSubjects = subjectsConfig[classKey];
      if (!validSubjects) {
        return res.status(400).json({ message: `Invalid class: ${classKey}` });
      }

      // Format marks for combined system
      const formattedMarks = validSubjects.map((subject) => {
        const subjectMarks = marks[subject] || {};
        return {
          subject,
          mcqScore: subjectMarks.mcqScore || 0,
          mcqTotal: subjectMarks.mcqTotal || 0,
          cqScore: subjectMarks.cqScore || 0,
          cqTotal: subjectMarks.cqTotal || 0,
        };
      });

      const newResult = new Result({
        student: studentId,
        class: classKey,
        semester,
        examType: "combined",
        marks: formattedMarks,
      });

      await newResult.save();

      res.status(201).json({
        message: "Combined result submitted successfully",
        data: newResult,
      });
    } catch (err) {
      console.error("Submit combined result error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ✅ Get results by exam type
router.get("/results/:studentId/:examType", authenticateToken, async (req, res) => {
  try {
    const { studentId, examType } = req.params;
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const result = await Result.findOne({ 
      student: studentId, 
      examType 
    }).sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({ message: `No ${examType.toUpperCase()} results found for this student` });
    }

    res.status(200).json({
      student: {
        name: student.name,
        roll: student.roll,
        class: student.class,
        section: student.section,
      },
      results: {
        examType: result.examType,
        semester: result.semester,
        marks: result.marks,
        totalMcqMarks: result.totalMcqMarks,
        totalCqMarks: result.totalCqMarks,
        totalMarks: result.totalMarks,
        averageGPA: result.averageGPA,
      },
    });
  } catch (err) {
    console.error("Error fetching results by exam type:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
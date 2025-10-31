const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { User, Student, Result } = require("../model/schema");
const bcrypt = require("bcryptjs");
const subjectsConfig = require("../config/subjectsConfig");

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

      req.currentUser = user; // Add user object to request
      next();
    } catch (err) {
      console.error("Role check error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  };
};

// Create student
router.post(
  "/student/create",
  authenticateToken,
  requireRole(["super_admin", "admin", "teacher"]),
  async (req, res) => {
    const { name, userName, password, roll, class: className, section } = req.body;

    if (!name || !userName || !password || !roll || !className) {
      return res.status(400).json({ message: "All fields are required" });
    } else if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    try {
      let student = await Student.findOne({ userName });
      if (student) {
        console.error(`Student with userName ${userName} already exists`);
        return res.status(400).json({ message: `Student ${userName} already exists` });
      }

      student = new Student({
        name,
        userName,
        password,
        roll,
        class: className,
        section,
        createdBy: req.currentUser._id,
      });

      // Hash password
      const salt = await bcrypt.genSalt(10);
      student.password = await bcrypt.hash(password, salt);

      await student.save();
      console.log(`Student created: ${userName} by user ${req.currentUser.email}`);
      res.status(201).json({
        message: "Student created successfully",
        student: {
          id: student._id,
          name: student.name,
          userName: student.userName,
          roll: student.roll,
          class: student.class,
          section: student.section,
          createdBy: {
            id: req.currentUser._id,
            firstName: req.currentUser.firstName,
            lastName: req.currentUser.lastName,
            email: req.currentUser.email,
            role: req.currentUser.role,
          },
          createdAt: student.createdAt,
        },
      });
    } catch (err) {
      console.error("Create student error:", err.message);
      if (err.code === 11000) {
        return res.status(400).json({ message: `Student ${userName} already exists` });
      }
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/student",
  authenticateToken,
  requireRole(["super_admin", "admin", "teacher"]),
  async (req, res) => {
    try {
      const { class: className, section } = req.query;
      let students;
      let query = {};

      if (req.currentUser.role === "super_admin") {
        // Super admin: see ALL students with optional filtering
        if (className && section) {
          query = { class: className, section: section };
        } else if (className) {
          query = { class: className };
        } else if (section) {
          query = { section: section };
        }

        students = await Student.find(query)
          .select("-password -refreshTokens")
          .populate("createdBy", "firstName lastName email role")
          .sort({ class: 1, section: 1, roll: 1 });

      } else if (req.currentUser.role === "admin") {
        // Admin: see students created by them or their teachers
        const teachers = await User.find({ 
          createdBy: req.currentUser._id,
          role: 'teacher'
        }).select("_id");
        
        const teacherIds = teachers.map(t => t._id);

        // Base query for admin's access
        query = {
          createdBy: { $in: [req.currentUser._id, ...teacherIds] }
        };

        // Add class/section filters if provided
        if (className) query.class = className;
        if (section) query.section = section;

        students = await Student.find(query)
          .select("-password -refreshTokens")
          .populate("createdBy", "firstName lastName email role")
          .sort({ class: 1, section: 1, roll: 1 });

      } else {
        // Teacher: see students in their assigned classes
        const teacher = await User.findById(req.currentUser._id);
        if (!teacher) {
          return res.status(404).json({ message: "Teacher not found" });
        }

        const assignedClasses = teacher.assignedClasses || [];
        
        if (assignedClasses.length === 0) {
          students = [];
        } else {
          // Build class queries for teacher's assigned classes
          const classQueries = assignedClasses.map(cls => ({
            class: cls.class,
            section: cls.section
          }));

          query = { $or: classQueries };

          // If specific class/section is requested, filter within assigned classes
          if (className && section) {
            // Check if the requested class is in teacher's assigned classes
            const isClassAssigned = assignedClasses.some(cls => 
              cls.class === className && cls.section === section
            );
            
            if (isClassAssigned) {
              query = { class: className, section: section };
            } else {
              // Teacher not assigned to this class-section combination
              students = [];
            }
          } else if (className) {
            // Filter by class within assigned classes
            const isClassAssigned = assignedClasses.some(cls => cls.class === className);
            if (isClassAssigned) {
              query = { 
                $or: assignedClasses
                  .filter(cls => cls.class === className)
                  .map(cls => ({ class: cls.class, section: cls.section }))
              };
            } else {
              students = [];
            }
          } else if (section) {
            // Filter by section within assigned classes
            const isSectionAssigned = assignedClasses.some(cls => cls.section === section);
            if (isSectionAssigned) {
              query = { 
                $or: assignedClasses
                  .filter(cls => cls.section === section)
                  .map(cls => ({ class: cls.class, section: cls.section }))
              };
            } else {
              students = [];
            }
          }

          if (!Array.isArray(students) || students.length !== 0) { // Only query if students is not already set to empty array
            students = await Student.find(query)
              .select("-password -refreshTokens")
              .populate("createdBy", "firstName lastName email role")
              .sort({ class: 1, section: 1, roll: 1 });
          }
        }
      }

      // Generate appropriate response message
      let message = `${students.length} students found`;
      if (req.currentUser.role === 'teacher') {
        message = `${students.length} students in your assigned classes`;
      } else if (req.currentUser.role === 'admin') {
        message = `${students.length} students under your management`;
      }

      res.json({ 
        message, 
        students,
        userRole: req.currentUser.role,
        ...(req.currentUser.role === 'teacher' && {
          assignedClasses: req.currentUser.assignedClasses
        })
      });
    } catch (err) {
      console.error("Get students error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);


// POST /api/result/create
router.post("/result", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
  const { studentId, classNumber, semester, scores } = req.body;

  // Ensure subjects match the class
  const subjects = subjectsConfig[classNumber];
  if (!subjects) return res.status(400).json({ message: "Invalid class number" });

  // Build marks array
  const marks = subjects.map(sub => ({
    subject: sub,
    score: scores[sub] || 0 // dynamic marks input
  }));

  const result = new Result({
    student: studentId,
    class: classNumber,
    semester,
    marks
  });

  await result.save();
  res.status(201).json({ message: "Result created successfully", result });
});

// Add these to your existing student routes

// Get single student
router.get(
  "/student/:id",
  authenticateToken,
  requireRole(["super_admin", "admin", "teacher"]),
  async (req, res) => {
    try {
      const student = await Student.findById(req.params.id)
        .select("-password -refreshTokens")
        .populate("createdBy", "firstName lastName email role");

      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      res.json({ student });
    } catch (err) {
      console.error("Get student error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Update student
router.put(
  "/student/:id",
  authenticateToken,
  requireRole(["super_admin", "admin", "teacher"]),
  async (req, res) => {
    const { name, userName, password, roll, class: className, section } = req.body;

    try {
      const student = await Student.findById(req.params.id);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      // Update fields
      if (name) student.name = name;
      if (userName) student.userName = userName;
      if (roll) student.roll = roll;
      if (className) student.class = className;
      if (section !== undefined) student.section = section;

      // Update password if provided
      if (password) {
        if (password.length < 6) {
          return res.status(400).json({ message: "Password must be at least 6 characters" });
        }
        const salt = await bcrypt.genSalt(10);
        student.password = await bcrypt.hash(password, salt);
      }

      await student.save();

      const updatedStudent = await Student.findById(req.params.id)
        .select("-password -refreshTokens")
        .populate("createdBy", "firstName lastName email role");

      res.json({ 
        message: "Student updated successfully", 
        student: updatedStudent 
      });
    } catch (err) {
      console.error("Update student error:", err.message);
      if (err.code === 11000) {
        return res.status(400).json({ message: "Username already exists" });
      }
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete student
router.delete(
  "/student/:id",
  authenticateToken,
  requireRole(["super_admin", "admin"]),
  async (req, res) => {
    try {
      const student = await Student.findById(req.params.id);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      await Student.findByIdAndDelete(req.params.id);
      res.json({ message: "Student deleted successfully" });
    } catch (err) {
      console.error("Delete student error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get results with filtering
router.get(
  "/result",
  authenticateToken,
  requireRole(["super_admin", "admin", "teacher"]),
  async (req, res) => {
    try {
      const { class: classFilter, studentId, semester } = req.query;
      let filter = {};

      if (classFilter) filter.class = classFilter;
      if (studentId) filter.student = studentId;
      if (semester) filter.semester = semester;

      // For teachers, only show their students' results
      if (req.currentUser.role === "admin") {
        const teacherStudents = await Student.find({ 
          createdBy: req.currentUser._id 
        }).select("_id");
        
        filter.student = { 
          ...filter.student, 
          $in: teacherStudents.map(s => s._id) 
        };
      }

      const results = await Result.find(filter)
        .populate("student", "name roll class section")
        .sort({ "student.class": 1, "student.roll": 1 });

      res.json(results);
    } catch (err) {
      console.error("Get results error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);



module.exports = router;
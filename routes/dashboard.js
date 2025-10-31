// routes/dashboard.js
const express = require("express");
const router = express.Router();
const { User, Student } = require("../model/schema");
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

      req.currentUser = user; // Add user object to request
      next();
    } catch (err) {
      console.error("Role check error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  };
};

// Get dashboard statistics
router.get("/stats", authenticateToken, requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: "admin" });
    const teacherCount = await User.countDocuments({ role: "teacher" });
    const studentCount = await Student.countDocuments();

    res.json({
      adminCount,
      teacherCount,
      studentCount,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Get chart data
router.get("/chart-data", authenticateToken, requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    // Example data - you can customize this based on your needs
    const chartData = [
      { name: "Admins", count: await User.countDocuments({ role: "admin" }) },
      { name: "Teachers", count: await User.countDocuments({ role: "teacher" }) },
      { name: "Students", count: await Student.countDocuments() },
    ];

    res.json(chartData);
  } catch (err) {
    console.error("Chart data error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
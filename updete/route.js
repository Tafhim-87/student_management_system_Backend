const express = require('express');
const router = express.Router();
const { User, Student } = require('../model/schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
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
        return res.status(404).json({ message: 'User not found' });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }

      req.currentUser = user; // Add user object to request
      next();
    } catch (err) {
      console.error('Role check error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  };
};
// Update user (super_admin, admin, teacher)
router.put('/user/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, password, role, adminCode, assignedClasses } = req.body;

    // Find the user to update
    let user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Role-based permission checks
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // Super admin can update any user
    // Admin can update teachers they created
    // Teachers can only update their own profile
    if (currentUser.role !== 'super_admin') {
      if (currentUser.role === 'admin' && user.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Not authorized to update this user' });
      }
      if (currentUser.role === 'teacher' && user._id.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Not authorized to update other users' });
      }
    }

    // Validate input
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.email = email;
    }

    if (password && password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    // Role-specific updates (only super_admin can change roles or adminCode)
    if (currentUser.role === 'super_admin') {
      if (role && ['super_admin', 'admin', 'teacher'].includes(role)) {
        user.role = role;
      }
      if (adminCode && user.role === 'admin') {
        const existingAdmin = await User.findOne({ adminCode });
        if (existingAdmin && existingAdmin._id.toString() !== id) {
          return res.status(400).json({ message: 'Admin code already in use' });
        }
        user.adminCode = adminCode;
      }
    }

    // Teachers can have assignedClasses updated by super_admin or admin
    if (assignedClasses && Array.isArray(assignedClasses) && ['super_admin', 'admin'].includes(currentUser.role)) {
      for (const classInfo of assignedClasses) {
        if (!classInfo.class || !classInfo.section) {
          return res.status(400).json({ message: 'Each assigned class must have both class and section' });
        }
      }
      user.assignedClasses = assignedClasses;
    }

    await user.save();

    // Prepare response
    const userResponse = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      ...(user.role === 'admin' && { adminCode: user.adminCode }),
      ...(user.role === 'teacher' && { assignedClasses: user.assignedClasses }),
      createdBy: user.createdBy
    };

    res.json({ message: 'User updated successfully', user: userResponse });

  } catch (err) {
    console.error('Update user error:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email or admin code already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Update student
router.put('/student/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, userName, password, roll, class: studentClass, section } = req.body;

    // Find the student to update
    let student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Role-based permission checks
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      const currentStudent = await Student.findById(req.user.id);
      if (!currentStudent || currentStudent._id.toString() !== id) {
        return res.status(404).json({ message: 'Current user not found' });
      }
    }

    // Super admin and admin can update any student
    // Teachers can update students in their assigned classes (only name, roll)
    // Students can update their own profile (only password, name)
    if (currentUser) {
      if (currentUser.role === 'teacher') {
        const isAssigned = currentUser.assignedClasses.some(
          cls => cls.class === student.class && cls.section === student.section
        );
        if (!isAssigned) {
          return res.status(403).json({ message: 'Not authorized to update this student' });
        }
        if (userName || studentClass || section) {
          return res.status(403).json({ message: 'Teachers can only update name or roll' });
        }
      }
    } else {
      // Student updating their own profile
      if (roll || studentClass || section || userName) {
        return res.status(403).json({ message: 'Students can only update name or password' });
      }
    }

    // Validate input
    if (userName && userName !== student.userName) {
      const existingStudent = await Student.findOne({ userName });
      if (existingStudent && existingStudent._id.toString() !== id) {
        return res.status(400).json({ message: 'Username already in use' });
      }
      student.userName = userName;
    }

    if (roll && studentClass && section) {
      const existingStudent = await Student.findOne({
        roll,
        class: studentClass,
        section,
        _id: { $ne: id }
      });
      if (existingStudent) {
        return res.status(400).json({ message: 'Roll number already exists in this class and section' });
      }
    }

    if (password && password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Update fields
    if (name) student.name = name;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      student.password = await bcrypt.hash(password, salt);
    }
    if (roll && ['super_admin', 'admin'].includes(currentUser?.role)) student.roll = roll;
    if (studentClass && ['super_admin', 'admin'].includes(currentUser?.role)) student.class = studentClass;
    if (section && ['super_admin', 'admin'].includes(currentUser?.role)) student.section = section;

    await student.save();

    // Prepare response
    const studentResponse = {
      id: student._id,
      name: student.name,
      userName: student.userName,
      roll: student.roll,
      class: student.class,
      section: student.section,
      createdBy: student.createdBy
    };

    res.json({ message: 'Student updated successfully', student: studentResponse });

  } catch (err) {
    console.error('Update student error:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Username or roll number already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user (super_admin, admin)
router.delete('/user/:id', authenticateToken, requireRole(['super_admin', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Find the user to delete
    let user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Role-based permission checks
    const currentUser = await User.findById(req.user.id);
    if (currentUser.role !== 'super_admin' && user.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to delete this user' });
    }

    // Prevent super_admin from being deleted
    if (user.role === 'super_admin') {
      return res.status(403).json({ message: 'Super admin cannot be deleted' });
    }

    // Delete user
    await User.deleteOne({ _id: id });

    res.json({ message: 'User deleted successfully' });

  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete student (super_admin, admin, teacher)
router.delete('/student/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the student to delete
    let student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Role-based permission checks
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(403).json({ message: 'Not authorized to delete students' });
    }

    if (currentUser.role === 'teacher') {
      const isAssigned = currentUser.assignedClasses.some(
        cls => cls.class === student.class && cls.section === student.section
      );
      if (!isAssigned) {
        return res.status(403).json({ message: 'Not authorized to delete this student' });
      }
    } else if (currentUser.role === 'admin' && student.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to delete this student' });
    }

    // Delete student
    await Student.deleteOne({ _id: id });

    res.json({ message: 'Student deleted successfully' });

  } catch (err) {
    console.error('Delete student error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
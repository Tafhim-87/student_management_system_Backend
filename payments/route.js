const express = require('express');
const router = express.Router();
const { User, Student } = require('../model/schema');
const jwt = require('jsonwebtoken');

// Middleware to verify access token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Middleware to check user role
const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (!allowedRoles.includes(user.role))
        return res.status(403).json({ message: 'Insufficient permissions' });
      req.currentUser = user;
      next();
    } catch (err) {
      console.error('Role check error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  };
};

// Utility function to calculate days left and handle payment reset
const calculatePaymentCycle = (lastPaymentDate) => {
  const now = new Date();
  const lastPayment = new Date(lastPaymentDate);
  const daysSinceLastPayment = Math.floor((now - lastPayment) / (1000 * 60 * 60 * 24));
  const daysLeft = 30 - daysSinceLastPayment;
  
  // If 30 days have passed, reset payment
  if (daysSinceLastPayment >= 30) {
    return {
      needsReset: true,
      daysLeft: 0,
      isOverdue: true
    };
  }
  
  return {
    needsReset: false,
    daysLeft: Math.max(0, daysLeft),
    isOverdue: false
  };
};

// ✅ Update student payment with 30-day cycle
router.put('/payments/:studentId', authenticateToken, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { paymentAmount, hasPaid } = req.body;

    // Validate input
    if (paymentAmount === undefined || typeof paymentAmount !== 'number' || paymentAmount < 0) {
      return res.status(400).json({ message: 'Invalid payment amount' });
    }
    if (hasPaid === undefined || typeof hasPaid !== 'boolean') {
      return res.status(400).json({ message: 'Invalid payment status' });
    }

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Authorization check
    if (
      req.currentUser.role !== 'super_admin' &&
      student.createdBy.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: 'Not authorized to update this student' });
    }

    // Check payment cycle and reset if needed
    const currentDate = new Date();
    let lastPaymentDate = student.lastPaymentDate || student.createdAt;
    const paymentCycle = calculatePaymentCycle(lastPaymentDate);

    // If payment is being made and it's overdue, reset the cycle
    let updatedPaymentData = {
      paymentAmount,
      hasPaid,
      lastPaymentDate: hasPaid ? currentDate : student.lastPaymentDate
    };

    // If 30 days have passed and payment is being made, reset the cycle
    if (paymentCycle.needsReset && hasPaid) {
      updatedPaymentData.lastPaymentDate = currentDate;
    }

    // ✅ Update payment info
    const updatedStudent = await Student.findByIdAndUpdate(
      studentId,
      { $set: updatedPaymentData },
      { new: true }
    ).populate('createdBy', 'firstName lastName email');

    // Calculate current payment cycle status for response
    const currentCycle = calculatePaymentCycle(updatedStudent.lastPaymentDate || updatedStudent.createdAt);

    // ✅ Final response with days left
    res.json({
      message: 'Student payment information updated successfully',
      student: {
        id: updatedStudent._id,
        name: updatedStudent.name,
        userName: updatedStudent.userName,
        roll: updatedStudent.roll,
        class: updatedStudent.class,
        section: updatedStudent.section,
        paymentAmount: updatedStudent.paymentAmount,
        hasPaid: updatedStudent.hasPaid,
        lastPaymentDate: updatedStudent.lastPaymentDate,
        daysLeft: currentCycle.daysLeft,
        isOverdue: currentCycle.isOverdue,
        nextPaymentDue: new Date(new Date(updatedStudent.lastPaymentDate || updatedStudent.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000),
        createdBy: updatedStudent.createdBy,
      },
    });
  } catch (err) {
    console.error('Update payment error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Get student payment status with days left
router.get('/payments/:studentId', authenticateToken, requireRole(['admin', 'super_admin', 'teacher']), async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Authorization check for non-super_admin users
    if (
      req.currentUser.role !== 'super_admin' &&
      student.createdBy.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: 'Not authorized to view this student' });
    }

    // Calculate payment cycle status
    const lastPaymentDate = student.lastPaymentDate || student.createdAt;
    const paymentCycle = calculatePaymentCycle(lastPaymentDate);

    // If payment needs reset, update the student record
    if (paymentCycle.needsReset && student.hasPaid) {
      await Student.findByIdAndUpdate(studentId, {
        $set: { hasPaid: false }
      });
      student.hasPaid = false;
    }

    res.json({
      student: {
        id: student._id,
        name: student.name,
        userName: student.userName,
        roll: student.roll,
        class: student.class,
        section: student.section,
        paymentAmount: student.paymentAmount,
        hasPaid: paymentCycle.needsReset ? false : student.hasPaid,
        lastPaymentDate: student.lastPaymentDate,
        daysLeft: paymentCycle.daysLeft,
        isOverdue: paymentCycle.isOverdue,
        nextPaymentDue: new Date(new Date(lastPaymentDate).getTime() + 30 * 24 * 60 * 60 * 1000),
        createdBy: student.createdBy,
      },
    });
  } catch (err) {
    console.error('Get payment error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Auto-reset payments cron job (to be called by a scheduled task)
router.post('/payments/auto-reset', authenticateToken, requireRole(['super_admin']), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find students whose last payment was more than 30 days ago and have paid
    const result = await Student.updateMany(
      {
        $or: [
          { lastPaymentDate: { $lt: thirtyDaysAgo } },
          { 
            lastPaymentDate: { $exists: false },
            createdAt: { $lt: thirtyDaysAgo }
          }
        ],
        hasPaid: true
      },
      {
        $set: { hasPaid: false }
      }
    );

    res.json({
      message: `Payment cycle reset completed. ${result.modifiedCount} students updated.`,
      resetCount: result.modifiedCount
    });
  } catch (err) {
    console.error('Auto-reset error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
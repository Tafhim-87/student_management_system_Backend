const express = require('express');
const router = express.Router();
const { User, Student } = require('../model/schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

// jwt secret
const JWT_SECRET = process.env.JWT_SECRET;

// Generate tokens function
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken };
};

// Generate admin code (format: YYMM001)
const generateAdminCode = async () => {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const prefix = year + month;
  
  // Find the latest admin code with the same prefix
  const latestAdmin = await User.findOne(
    { adminCode: new RegExp(`^${prefix}`) },
    { adminCode: 1 },
    { sort: { adminCode: -1 } }
  );
  
  let sequence = 1;
  if (latestAdmin && latestAdmin.adminCode) {
    const lastSequence = parseInt(latestAdmin.adminCode.slice(-3));
    sequence = lastSequence + 1;
  }
  
  return prefix + sequence.toString().padStart(3, '0');
};

// Middleware to verify access token
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

// Create initial super admin (run this once manually or via script)
router.post('/setup-super-admin', async (req, res) => {
  try {
    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ role: 'super_admin' });
    if (existingSuperAdmin) {
      return res.status(400).json({ message: 'Super admin already exists' });
    }

    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Create super admin
    const superAdmin = new User({
      firstName,
      lastName,
      email,
      password,
      role: 'super_admin'
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    superAdmin.password = await bcrypt.hash(password, salt);

    await superAdmin.save();

    res.status(201).json({ 
      message: 'Super admin created successfully',
      user: {
        id: superAdmin._id,
        firstName: superAdmin.firstName,
        lastName: superAdmin.lastName,
        email: superAdmin.email,
        role: superAdmin.role
      }
    });

  } catch (err) {
    console.error('Super admin setup error:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Super admin creates admin
router.post('/admin/create', authenticateToken, requireRole(['super_admin']), async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate admin code
    const adminCode = await generateAdminCode();

    // Create new admin
    user = new User({
      firstName,
      lastName,
      email,
      password,
      role: 'admin',
      adminCode,
      createdBy: req.user.id // Set creator as super admin
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    res.status(201).json({ 
      message: 'Admin created successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        adminCode: user.adminCode,
        createdBy: user.createdBy
      }
    });

  } catch (err) {
    console.error('Create admin error:', err.message);
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.adminCode) {
        return res.status(400).json({ message: 'Admin code already exists. Please try again.' });
      }
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin creates teacher with multiple classes
router.post('/teacher/create', authenticateToken, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { firstName, lastName, email, password, assignedClasses } = req.body;

    if (!firstName || !lastName || !email || !password || !assignedClasses || !Array.isArray(assignedClasses)) {
      return res.status(400).json({ message: 'All fields are required and assignedClasses must be an array' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Validate assignedClasses structure
    for (const classInfo of assignedClasses) {
      if (!classInfo.class || !classInfo.section) {
        return res.status(400).json({ message: 'Each assigned class must have both class and section' });
      }
    }

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new teacher
    user = new User({
      firstName,
      lastName,
      email,
      password,
      role: 'teacher',
      assignedClasses,
      createdBy: req.user.id // Set creator as admin
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    res.status(201).json({ 
      message: 'Teacher created successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        assignedClasses: user.assignedClasses,
        createdBy: user.createdBy
      }
    });

  } catch (err) {
    console.error('Create teacher error:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin creates student
router.post(
  '/student/create',
  authenticateToken,
  requireRole(['admin', 'super_admin']),
  async (req, res) => {
    try {
      const { name, userName, password, roll, class: studentClass, section } = req.body;

      if (!name || !userName || !password || !roll || !studentClass || !section) {
        return res.status(400).json({ message: 'All fields are required' });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }

      // ✅ 1. Check for duplicate username
      const existingUser = await Student.findOne({ userName });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }

      // ✅ 2. Check for duplicate roll number in same class + section
      const existingRoll = await Student.findOne({
        class: studentClass,
        section,
        roll,
      });
      if (existingRoll) {
        return res.status(400).json({
          message: `Roll ${roll} already exists in Class ${studentClass}${section ? ` (${section})` : ''}`,
        });
      }

      // ✅ 3. Create new student
      const student = new Student({
        name,
        userName,
        password,
        roll,
        class: studentClass,
        section,
        createdBy: req.user.id,
      });

      // ✅ 4. Hash password
      const salt = await bcrypt.genSalt(10);
      student.password = await bcrypt.hash(password, salt);

      await student.save();

      res.status(201).json({
        message: 'Student created successfully',
        student: {
          id: student._id,
          name: student.name,
          userName: student.userName,
          roll: student.roll,
          class: student.class,
          section: student.section,
          createdBy: student.createdBy,
        },
      });
    } catch (err) {
      console.error('Create student error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Teacher gets students from their assigned classes
router.get('/teacher/students', authenticateToken, requireRole(['teacher', 'super_admin']), async (req, res) => {
  try {
    const teacher = await User.findById(req.user.id);
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Extract all class-section combinations the teacher is assigned to
    const teacherClasses = teacher.assignedClasses.map(cls => ({
      class: cls.class,
      section: cls.section
    }));

    if (teacherClasses.length === 0) {
      return res.json({ message: 'No classes assigned to this teacher', students: [] });
    }

    // Build query to find students in any of the teacher's assigned classes
    const studentQuery = {
      $or: teacherClasses.map(cls => ({
        class: cls.class,
        section: cls.section
      }))
    };

    const students = await Student.find(studentQuery)
      .select('-password -refreshTokens')
      .populate('createdBy', 'firstName lastName email')
      .sort({ class: 1, section: 1, roll: 1 });

    res.json({ 
      message: `${students.length} students found in your assigned classes`,
      teacherClasses,
      students 
    });

  } catch (err) {
    console.error('Get teacher students error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Teacher gets students by specific class and section
router.get('/teacher/students/:class/:section', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { class: className, section } = req.params;
    const teacher = await User.findById(req.user.id);

    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Check if teacher is assigned to this specific class and section
    const isAssigned = teacher.assignedClasses.some(cls => 
      cls.class === className && cls.section === section
    );

    if (!isAssigned) {
      return res.status(403).json({ 
        message: 'You are not assigned to this class and section' 
      });
    }

    const students = await Student.find({ 
      class: className, 
      section: section 
    })
      .select('-password -refreshTokens')
      .populate('createdBy', 'firstName lastName email')
      .sort({ roll: 1 });

    res.json({ 
      message: `${students.length} students found in ${className}-${section}`,
      students 
    });

  } catch (err) {
    console.error('Get class students error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// // Admin gets all students (with filtering options)
// router.get('/students', authenticateToken, requireRole(['admin', 'super_admin']), async (req, res) => {
//   try {
//     const { class: className, section } = req.query;
//     let query = {};

//     // Add filters if provided
//     if (className) query.class = className;
//     if (section) query.section = section;

//     const students = await Student.find(query)
//       .select('-password -refreshTokens')
//       .populate('createdBy', 'firstName lastName email')
//       .sort({ class: 1, section: 1, roll: 1 });

//     res.json({ 
//       message: `${students.length} students found`,
//       students 
//     });

//   } catch (err) {
//     console.error('Get students error:', err.message);
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// Signin route (for all roles)
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user (for teachers/admins)
    const user = await User.findOne({ email });
    if (!user) {
      // Check if it's a student trying to login
      const student = await Student.findOne({ userName: email });
      if (!student) {
        return res.status(400).json({ message: 'Invalid email/username or password' });
      }

      // Check student password
      const isMatch = await bcrypt.compare(password, student.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid email/username or password' });
      }

      // Generate tokens for student
      const { accessToken, refreshToken } = generateTokens(student._id);

      // Save refresh token to student (limit to 5 devices)
      student.refreshTokens.push({ token: refreshToken });
      if (student.refreshTokens.length > 5) {
        student.refreshTokens = student.refreshTokens.slice(-5);
      }
      await student.save();

      return res.status(200).json({ 
        accessToken,
        refreshToken,
        user: {
          id: student._id,
          name: student.name,
          userName: student.userName,
          roll: student.roll,
          class: student.class,
          section: student.section,
          role: 'student'
        }
      });
    }

    // Check password for teacher/admin
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Save refresh token to user (limit to 5 devices)
    user.refreshTokens.push({ token: refreshToken });
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    await user.save();

    // Prepare user response data
    const userResponse = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role
    };

    // Add role-specific fields
    if (user.role === 'admin') {
      userResponse.adminCode = user.adminCode;
    } else if (user.role === 'teacher') {
      userResponse.assignedClasses = user.assignedClasses;
    }

    res.status(200).json({ 
      accessToken,
      refreshToken,
      user: userResponse
    });

  } catch (err) {
    console.error('Signin error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Refresh token route (for both users and students)
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    // Check both User and Student collections
    let user = await User.findOne({ 'refreshTokens.token': refreshToken });
    let isStudent = false;

    if (!user) {
      user = await Student.findOne({ 'refreshTokens.token': refreshToken });
      isStudent = true;
    }

    if (!user) {
      return res.status(403).json({ message: 'Invalid refresh token' });
    }

    // Remove the used refresh token
    user.refreshTokens = user.refreshTokens.filter(token => token.token !== refreshToken);

    // Generate new tokens
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

    // Save new refresh token
    user.refreshTokens.push({ token: newRefreshToken });
    await user.save();

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });

  } catch (err) {
    console.error('Refresh token error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all users (super_admin sees all, others see only their created users)
router.get('/users', authenticateToken, requireRole(['super_admin', 'admin']), async (req, res) => {
  try {
    let users;
    // Super admin sees all users
    if (req.currentUser.role === 'super_admin') {
      users = await User.find()
        .select('-password -refreshTokens')
        .populate('createdBy', 'firstName lastName email');
    } else {
      // Admins see only users they created
      users = await User.find({ createdBy: req.user.id })
        .select('-password -refreshTokens')
        .populate('createdBy', 'firstName lastName email');
    }

    res.json({ message: `${users.length} users found`, users });
  } catch (err) {
    console.error('Get users error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get teachers by class and section (for admin/teacher access)
router.get('/teachers', authenticateToken, requireRole(['admin', 'super_admin', 'teacher']), async (req, res) => {
  try {
    const { class: className, section } = req.query;
    let query = { role: 'teacher' };

    // Handle different user roles
    switch (req.currentUser.role) {
      case 'admin':
        // Regular admin: only see teachers they created
        query.createdBy = req.user.id;
        break;
      
      case 'teacher':
        // Teacher: only see teachers in their assigned classes
        const teacherClasses = req.currentUser.assignedClasses.map(cls => cls.class);
        query.assignedClasses = {
          $elemMatch: {
            class: { $in: teacherClasses }
          }
        };
        break;
      
      case 'super_admin':
        // Super admin: can see all teachers (no additional filter)
        break;
      
      default:
        return res.status(403).json({ message: 'Unauthorized access' });
    }

    // Apply class/section filters if provided
    if (className || section) {
      const classFilter = {};
      if (className) classFilter.class = className;
      if (section) classFilter.section = section;
      
      // If there's already an assignedClasses filter, merge with it
      if (query.assignedClasses) {
        query.assignedClasses.$elemMatch = {
          ...query.assignedClasses.$elemMatch,
          ...classFilter
        };
      } else {
        query.assignedClasses = {
          $elemMatch: classFilter
        };
      }
    }

    const teachers = await User.find(query)
      .select('-password -refreshTokens')
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Generate appropriate response message based on user role
    let responseMessage;
    switch (req.currentUser.role) {
      case 'admin':
        responseMessage = `${teachers.length} teachers created by you`;
        break;
      case 'teacher':
        responseMessage = `${teachers.length} teachers in your assigned classes`;
        break;
      case 'super_admin':
        responseMessage = `${teachers.length} teachers in the system`;
        break;
      default:
        responseMessage = `${teachers.length} teachers found`;
    }

    res.json({ 
      message: responseMessage, 
      teachers,
      userRole: req.currentUser.role
    });
  } catch (err) {
    console.error('Get teachers error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Protected route example
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // Check if it's a user or student
    let user = await User.findById(req.user.id).select('-password -refreshTokens').populate('createdBy', 'firstName lastName email');
    
    if (!user) {
      // Check if it's a student
      user = await Student.findById(req.user.id).select('-password -refreshTokens').populate('createdBy', 'firstName lastName email');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
    }

    res.json({ user });
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout route
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    // Check both User and Student collections
    let user = await User.findById(req.user.id);
    if (!user) {
      user = await Student.findById(req.user.id);
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.refreshTokens = user.refreshTokens.filter(token => token.token !== refreshToken);
    await user.save();

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
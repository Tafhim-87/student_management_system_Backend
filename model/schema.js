const mongoose = require("mongoose");
const getGrade = require("../config/gradeUtils");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  role: {
    type: String,
    enum: ["super_admin", "admin", "teacher", "student"],
    required: true,
    default: "student",
  },
  assignedClasses: [
    {
      class: {
        type: String,
        required: true,
      },
      section: {
        type: String,
        required: true,
      },
    },
  ],
  adminCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  refreshTokens: [
    {
      token: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
        expires: 7 * 24 * 60 * 60,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  userName: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  roll: {
    type: Number,
    required: true,
  },
  class: {
    type: String,
    required: true,
  },
  section: {
    type: String,
    required: true,
  },
  paymentAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  hasPaid: {
    type: Boolean,
    default: false,
  },
  paymentDetails: [
    {
      initialAmount: {
        type: Number,
        required: true,
        min: 0,
      },
      increasedAmount: {
        type: Number,
        required: true,
        min: 0,
      },
      dueDate: {
        type: Date,
        required: true,
      },
      isPaid: {
        type: Boolean,
        default: false,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  refreshTokens: [
    {
      token: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
        expires: 7 * 24 * 60 * 60,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Pre-save middleware to update paymentAmount and hasPaid based on paymentDetails
studentSchema.pre("save", function (next) {
  try {
    if (this.paymentDetails && this.paymentDetails.length > 0) {
      const latestPayment = this.paymentDetails[this.paymentDetails.length - 1];
      const currentDate = new Date();

      this.hasPaid = latestPayment.isPaid;

      if (latestPayment.isPaid) {
        this.paymentAmount = 0;
      } else if (currentDate > latestPayment.dueDate) {
        this.paymentAmount = latestPayment.increasedAmount;
      } else {
        this.paymentAmount = latestPayment.initialAmount;
      }
    } else {
      this.paymentAmount = 0;
      this.hasPaid = false;
    }
    next();
  } catch (err) {
    console.error("Pre-save payment error:", err.message);
    next(err);
  }
});

const resultSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  class: {
    type: String,
    required: true,
  },
  semester: {
    type: String,
    enum: ["1st", "2nd", "3rd"],
    required: true,
  },
  examType: {
    type: String,
    enum: ["mcq", "cq", "combined"],
    required: true,
    default: "combined"
  },
  marks: [
    {
      subject: {
        type: String,
        required: true,
      },
      // For MCQ system
      mcqScore: {
        type: Number,
        default: 0,
        min: 0,
      },
      mcqTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      // For CQ system
      cqScore: {
        type: Number,
        default: 0,
        min: 0,
      },
      cqTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Combined score (auto-calculated)
      totalScore: {
        type: Number,
        default: 0,
      },
      grade: {
        type: String,
      },
      gpa: {
        type: Number,
      },
    },
  ],
  // Overall totals
  totalMcqMarks: {
    type: Number,
    default: 0,
  },
  totalCqMarks: {
    type: Number,
    default: 0,
  },
  totalMarks: {
    type: Number,
    default: 0,
  },
  averageGPA: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Pre-save middleware to calculate grades, totalMarks, and averageGPA
resultSchema.pre("save", function (next) {
  try {
    if (!this.marks || this.marks.length === 0) {
      console.error("Pre-save error: Marks array is empty");
      return next(new Error("Marks array cannot be empty"));
    }

    let totalMcq = 0;
    let totalCq = 0;
    let totalMarks = 0;
    let gpaSum = 0;
    let subjectCount = 0;

    this.marks = this.marks.map((m) => {
      // Calculate total score for the subject
      const subjectTotalScore = (m.mcqScore || 0) + (m.cqScore || 0);
      const subjectTotalMarks = (m.mcqTotal || 0) + (m.cqTotal || 0);
      
      // Validate scores
      if (subjectTotalScore > subjectTotalMarks) {
        console.error(`Pre-save error: Score exceeds total marks for subject ${m.subject}`);
        return next(new Error(`Score exceeds total marks for subject ${m.subject}`));
      }

      // Calculate percentage for grading (assuming 100% scale)
      const percentage = subjectTotalMarks > 0 ? (subjectTotalScore / subjectTotalMarks) * 100 : 0;
      
      const { grade, gpa } = getGrade(percentage);
      
      totalMcq += m.mcqScore || 0;
      totalCq += m.cqScore || 0;
      totalMarks += subjectTotalScore;
      gpaSum += gpa;
      subjectCount++;

      return { 
        ...m, 
        totalScore: subjectTotalScore,
        grade, 
        gpa 
      };
    });

    this.totalMcqMarks = totalMcq;
    this.totalCqMarks = totalCq;
    this.totalMarks = totalMarks;
    this.averageGPA = subjectCount > 0 ? parseFloat((gpaSum / subjectCount).toFixed(2)) : 0;

    console.log("Pre-save calculated:", {
      totalMcqMarks: this.totalMcqMarks,
      totalCqMarks: this.totalCqMarks,
      totalMarks: this.totalMarks,
      averageGPA: this.averageGPA,
    });
    next();
  } catch (err) {
    console.error("Pre-save error:", err.message);
    next(err);
  }
});

// Create models
const User = mongoose.model("User", userSchema);
const Student = mongoose.model("Student", studentSchema);
const Result = mongoose.model("Result", resultSchema);

module.exports = { User, Student, Result };
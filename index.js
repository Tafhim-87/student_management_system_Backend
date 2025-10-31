const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./database/connectDB");
const cors = require("cors");

const signin = require("./signin/route");
const students = require("./students/route");
const dashboard = require("./routes/dashboard");
const result = require("./result/route");
const update = require("./updete/route");
const payments = require("./payments/route");

dotenv.config();

const app = express();

// Connect to database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Auth API is working!");
});

// Routes
app.use("/api", signin);
app.use("/api", students);
app.use("/api", dashboard);
app.use("/api", result);
app.use("/api", update);
app.use("/api", payments);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

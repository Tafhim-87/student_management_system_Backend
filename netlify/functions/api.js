const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('../../database/connectDB');
const cors = require('cors');
const serverless = require('serverless-http');
const router = express.Router();

dotenv.config();

const signin = require("../../signin/route");
const students = require("../../students/route");
const dashboard = require("../../routes/dashboard");
const result = require("../../result/route");
const update = require("../../updete/route");
const payments = require("../../payments/route");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', router);

// DB connection state (persists across warm invocations)
let dbConnected = false;
let dbPromise = null;

app.use(async (req, res, next) => {
    if (dbConnected) return next();

    if (!dbPromise) {
        dbPromise = connectDB()
            .then(() => {
                dbConnected = true;
                console.log('✅ DB connected');
            })
            .catch(err => {
                dbPromise = null; // Allow retry
                throw err;
            });
    }

    try {
        await dbPromise;
        next();
    } catch (error) {
        console.error('❌ DB connection failed:', error);
        res.status(500).json({
            error: 'Database unavailable',
            message: error.message
        });
    }
});

// Routes
router.get('/', (req, res) => {
    res.json({ message: 'Hello from Lambda!' });
});

router.use('/data', signin);
router.use('/data', students);
router.use('/data', dashboard);
router.use('/data', result);
router.use('/data', update);
router.use('/data', payments);

module.exports.handler = serverless(app);


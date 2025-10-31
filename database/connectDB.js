const mongoose = require('mongoose');

const connectDB = async () => {
    const mongoURI = `${process.env.MONGO_URI}`;

    if (!mongoURI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    try {
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
};

module.exports = connectDB;

// mongodb+srv://tafhimhasan87:Tafhim87@cluster0.ewn4x97.mongodb.net/StudentManagement?appName=Cluster0
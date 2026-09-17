require('dotenv').config();

const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const fileUploader = require('express-fileupload');
const { rateLimit } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

const connectDB = require('./config/db');
const seedDefaultCategories = require('./utils/seedCategories');

const origin = process.env.ALLOWED_ORIGIN;

// Express app and server initialization
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// Rate limit setup
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

app.use(limiter);

// Helmet security setup
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com',
    'https://lh3.googleusercontent.com'
    ],
  },
}));

// CORS configuration
app.use(cors({
  origin: origin ? origin.split(',') : true,
  credentials: true,
}));

// Additional middlewares
app.use(compression());
app.use(fileUploader({
  useTempFiles: true,
  tempFileDir: path.join(require('os').tmpdir(), 'ccir-uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  abortOnLimit: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE));
app.use(morgan('tiny'));

// Importing and using routers
const AuthRouter = require('./routes/authRoute');
const UserRouter = require('./routes/userRoute');
const CategoryRouter = require('./routes/categoryRoute');
const ComplaintRouter = require('./routes/complaintRoute');
const LocationRouter = require('./routes/locationRoute');

// API routes
app.use('/api/v1/auth', AuthRouter);
app.use('/api/v1/users', UserRouter);
app.use('/api/v1/categories', CategoryRouter);
app.use('/api/v1/complaints', ComplaintRouter);
app.use('/api/v1/location', LocationRouter);

app.get('/api/v1/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Serve the reference frontend, if it has been built (client/dist)
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Express 5 (path-to-regexp v8) requires a named wildcard, not a bare '*'.
  app.get('/*splat', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handling middlewares
const NotFoundMiddleware = require('./middleware/notFoundRoute');
const ErrorMiddleware = require('./middleware/errorHandler');

app.use(NotFoundMiddleware);
app.use(ErrorMiddleware);

// Start the app
const port = process.env.PORT || 8080;

const startApp = async () => {
  try {
    await connectDB();
    await seedDefaultCategories();

    server.listen(port, () => {
      console.log(`App is listening on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
};

startApp();

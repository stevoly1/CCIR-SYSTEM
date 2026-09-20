const fs = require('fs');
const express = require('express');
const path = require('path');
const fileUploader = require('express-fileupload');
const { rateLimit } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const { MAX_IMAGE_BYTES } = require('./services/imageInspectionService');
const { getBrowserSecurityConfig } = require('./config/browserSecurity');
const requireApprovedOrigin = require('./middleware/originGuard');

const browserSecurity = getBrowserSecurityConfig(process.env);

// Express app and server initialization
const app = express();
app.set('trust proxy', browserSecurity.trustProxy);

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
app.use(cors(browserSecurity.corsOptions));

// Additional middlewares
app.use(compression());
app.use('/api/v1', requireApprovedOrigin);
app.use(fileUploader({
  useTempFiles: true,
  tempFileDir: path.join(require('os').tmpdir(), 'ccir-uploads'),
  limits: { fileSize: MAX_IMAGE_BYTES },
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

module.exports = app;

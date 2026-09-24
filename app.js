const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const { getBrowserSecurityConfig } = require('./config/browserSecurity');
const requireApprovedOrigin = require('./middleware/originGuard');
const multipartUpload = require('./middleware/multipartUpload');
const { requestLogger } = require('./middleware/requestLogger');
const { apiRateLimit } = require('./middleware/apiRateLimit');
const { mountReferenceClient } = require('./middleware/referenceClient');

const browserSecurity = getBrowserSecurityConfig(process.env);

// Express app and server initialization
const app = express();
app.set('trust proxy', browserSecurity.trustProxy === 0 ? false : browserSecurity.trustProxy);
app.use(requestLogger);

// Helmet security setup
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com',
    'https://lh3.googleusercontent.com'
    ],
    ...(browserSecurity.upgradeInsecureRequests ? {} : { upgradeInsecureRequests: null }),
  },
}));

// CORS configuration
app.use(cors(browserSecurity.corsOptions));

// Rate limit setup: over-limit requests get the standard 429 JSON error. It comes after CORS so
// that a browser on the approved origin can read that error.
app.use(apiRateLimit);

// Additional middlewares
app.use(compression());
app.use('/api/v1', requireApprovedOrigin);
app.use(multipartUpload);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE));

// Test-only contract checking (a no-op unless OPENAPI_VALIDATE=true, and always in production).
const { contractTestMiddleware } = require('./middleware/openapiResponseValidator');
const contractChecks = contractTestMiddleware();
if (contractChecks.length > 0) app.use(contractChecks);

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

app.use('/api/v1/health', require('./routes/healthRoute'));

// Interactive API documentation (switch off with API_DOCS_UI=false).
app.use('/api/v1/docs', require('./routes/docsRoute'));

// The published API contract (OpenAPI 3.1), as JSON.
const { getContract } = require('./utils/openapi');
app.get('/api/v1/openapi.json', (req, res) => res.json(getContract()));

// Serve the reference frontend, if it has been built (client/dist)
mountReferenceClient(app, path.join(__dirname, 'client', 'dist'));

// Error handling middlewares
const NotFoundMiddleware = require('./middleware/notFoundRoute');
const ErrorMiddleware = require('./middleware/errorHandler');

app.use(NotFoundMiddleware);
app.use(ErrorMiddleware);

module.exports = app;

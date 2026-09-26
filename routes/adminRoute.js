const express = require('express');
const { authentication } = require('../middleware/auth');
const restrictTo = require('../middleware/restrictTo');
const validate = require('../middleware/validate');
const { emptyQuerySchema, idParamsSchema } = require('../validators/commonValidator');
const { listJobsQuerySchema, dismissJobSchema, retryFailedSchema } = require('../validators/adminJobsValidator');
const { listJobs, jobsSummary, retryJob, dismissJob, retryFailedJobs } = require('../controllers/adminJobsController');

// Administrators' tools. Background jobs: see what failed, and retry or dismiss it.
const AdminRouter = express.Router();
AdminRouter.use(authentication, restrictTo('admin'));
AdminRouter.get('/jobs', validate({ query: listJobsQuerySchema }), listJobs);
AdminRouter.get('/jobs/summary', validate({ query: emptyQuerySchema }), jobsSummary);
AdminRouter.post('/jobs/retry-failed', validate({ body: retryFailedSchema, query: emptyQuerySchema }), retryFailedJobs);
AdminRouter.post('/jobs/:id/retry', validate({ params: idParamsSchema, body: emptyQuerySchema, query: emptyQuerySchema }), retryJob);
AdminRouter.post('/jobs/:id/dismiss', validate({ params: idParamsSchema, body: dismissJobSchema, query: emptyQuerySchema }), dismissJob);

module.exports = AdminRouter;

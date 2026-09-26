const { StatusCodes } = require('http-status-codes');
const adminJobs = require('../services/jobs/adminJobsService');

const listJobs = async (req, res) => res.status(StatusCodes.OK).json(await adminJobs.listJobs(req.query));
const jobsSummary = async (req, res) => res.status(StatusCodes.OK).json(await adminJobs.summary());
const retryJob = async (req, res) => res.status(StatusCodes.OK).json({ job: await adminJobs.retryJob(req.params.id, req.user.userId) });
const dismissJob = async (req, res) => res.status(StatusCodes.OK).json({ job: await adminJobs.dismissJob(req.params.id, req.user.userId, req.body.reason) });
const retryFailedJobs = async (req, res) => res.status(StatusCodes.OK).json(await adminJobs.retryFailedJobs(req.body.queue, req.user.userId));

module.exports = { listJobs, jobsSummary, retryJob, dismissJob, retryFailedJobs };

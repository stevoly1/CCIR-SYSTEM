const express = require('express');
const { checkReadiness } = require('../services/readinessService');

const HealthRouter = express.Router();
// Liveness answers from the process alone, so an orchestrator never restarts it for a database outage.
const live = (req, res) => res.status(200).json({ status: 'ok' });

HealthRouter.get('/', live); // legacy alias of /live
HealthRouter.get('/live', live);
HealthRouter.get('/ready', async (req, res) => {
  const { httpStatus, body } = await checkReadiness();
  res.status(httpStatus).json(body);
});

module.exports = HealthRouter;

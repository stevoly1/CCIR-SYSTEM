const { Category, Complaint } = require('../../models');
// Module-object access lets the local journey server and tests replace the AI service.
const ai = require('../ai');
const reportPhoto = require('../ai/reportPhoto');
const { AiError } = require('../ai/aiError');
const { getAiConfig } = require('../../config/ai');
const { registerHandler } = require('./registry');
const { JobError } = require('./jobError');
const { decideClassification } = require('../../policies/classificationPolicy');
const { classificationRetry, recordClassificationFailure } = require('../classificationRequests');
const { getLogger } = require('../../utils/logger');

const WRITE_TRIES = 3;
let notConfiguredLogged = false;

const loadReport = (id) => Complaint.findById(id).select('description images category categorySource prioritySource ai.requestSeq');

// Known AI failures carry stable codes. Invalid output gets one additional attempt.
const asJobFailure = (error, entry) => {
  const config = getAiConfig();
  const log = { provider: config.provider, model: config.kimi.model };
  if (error instanceof JobError) {
    error.log = log;
    return error;
  }
  if (!(error instanceof AiError)) {
    // Unexpected AI-service errors can contain report text. Keep only the stable job code.
    const failure = JobError.of('INTERNAL');
    failure.log = log;
    return failure;
  }
  if (error.code === 'NOT_CONFIGURED' && !notConfiguredLogged) {
    notConfiguredLogged = true;
    getLogger().warn({ event: 'ai_not_configured' }, 'AI is not configured; reports are filed as Other and marked AI failed');
  }
  const retryable = error.code === 'INVALID_OUTPUT' ? entry.lastErrorCode !== 'INVALID_OUTPUT' : undefined;
  const failure = JobError.of(error.code, { retryAfterMs: error.retryAfterMs, retryable });
  failure.log = log;
  return failure;
};

registerHandler('classify_report', {
  queue: 'ai',
  run: async (entry) => {
    const { complaintId, requestSeq } = entry.refs;
    let report = await loadReport(complaintId);
    if (!report || report.ai?.requestSeq !== requestSeq) return { log: { stale: true } };
    const categories = await Category.find({ isActive: true }).select('name');
    let photo;
    try {
      photo = await reportPhoto.readFirstPhoto(report);
    } catch (error) {
      throw asJobFailure(error, entry);
    }
    let result;
    try {
      result = await ai.classifyReport({ description: report.description, image: photo ?? undefined, categories: categories.map((category) => category.name) });
    } catch (error) {
      throw asJobFailure(error, entry);
    }
    const log = { provider: result.meta.provider, model: result.meta.model };
    for (let tries = 0; tries < WRITE_TRIES; tries += 1) {
      const { filter, update } = decideClassification({
        report, requestSeq, result, categories, inputMode: photo ? 'TEXT_AND_IMAGE' : 'TEXT_ONLY',
        threshold: getAiConfig().disagreementConfidence, now: new Date(),
      });
      if ((await Complaint.updateOne(filter, update)).matchedCount === 1) return { log };
      report = await loadReport(complaintId);
      if (!report || report.ai?.requestSeq !== requestSeq) return { log: { ...log, stale: true } };
    }
    throw new Error('The classification could not be written: the report kept changing');
  },
  onFinalFailure: (entry, code) => recordClassificationFailure(entry.refs, code),
  onRetry: classificationRetry,
});

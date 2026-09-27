const { z } = require('zod');
const { pageSchema, limitSchema } = require('./commonValidator');

const queueSchema = z.enum(['ai', 'email']);
const listJobsQuerySchema = z.strictObject({
  state: z.literal('FAILED').default('FAILED'),
  queue: queueSchema.optional(),
  page: pageSchema,
  limit: limitSchema,
});
const dismissJobSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
const retryFailedSchema = z.strictObject({ queue: queueSchema });

module.exports = { listJobsQuerySchema, dismissJobSchema, retryFailedSchema };

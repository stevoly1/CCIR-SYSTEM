const crypto = require('crypto');
const { TooManyRequestsError } = require('../errors');

const createThrottleService = ({ model, hmacSecret, now = () => new Date() }) => {
  if (typeof hmacSecret !== 'string' || hmacSecret.length === 0) {
    throw new Error('AUTH_THROTTLE_HMAC_SECRET is required');
  }
  if (!model || typeof model.findOneAndUpdate !== 'function') {
    throw new TypeError('A throttle model is required');
  }

  const keyFor = (scope, subject) => {
    if (typeof scope !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(scope)) {
      throw new TypeError('Throttle scope is invalid');
    }
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new TypeError('Throttle subject is invalid');
    }
    const digest = crypto.createHmac('sha256', hmacSecret).update(subject).digest('hex');
    return `${scope}:${digest}`;
  };

  const consume = async (scope, subject, { limit, windowMs }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new TypeError('Throttle limit and window must be positive integers');
    }
    const currentTime = now();
    if (!(currentTime instanceof Date) || Number.isNaN(currentTime.getTime())) {
      throw new TypeError('Throttle clock must return a valid Date');
    }
    const nextResetAt = new Date(currentTime.getTime() + windowMs);
    const expired = {
      $or: [
        { $eq: [{ $type: '$resetAt' }, 'missing'] },
        { $lte: ['$resetAt', { $literal: currentTime }] },
      ],
    };
    const record = await model.findOneAndUpdate(
      { _id: keyFor(scope, subject) },
      [{
        $set: {
          count: {
            $cond: [expired, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }],
          },
          resetAt: {
            $cond: [expired, { $literal: nextResetAt }, '$resetAt'],
          },
        },
      }],
      { new: true, upsert: true },
    );
    const result = { count: record.count, resetAt: record.resetAt };
    if (record.count > limit) throw new TooManyRequestsError();
    return result;
  };

  const peek = async (scope, subject) => {
    const record = await model.findById(keyFor(scope, subject));
    const currentTime = now();
    if (!record || record.resetAt <= currentTime) return { count: 0, resetAt: null };
    return { count: record.count, resetAt: record.resetAt };
  };

  const clear = async (scope, subject) => {
    await model.deleteOne({ _id: keyFor(scope, subject) });
  };

  return { clear, consume, peek };
};

module.exports = { createThrottleService };

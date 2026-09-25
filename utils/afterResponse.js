const { getLogger } = require('./logger');

// Work that must not delay the answer or change it, for example an email whose sending time would
// otherwise tell the caller whether an account exists. Failures are logged, never thrown.
const afterResponse = (res, task) => {
    res.once('finish', () => {
        Promise.resolve()
            .then(task)
            .catch((err) => getLogger().warn({ err }, 'Deferred task failed'));
    });
};

module.exports = { afterResponse };

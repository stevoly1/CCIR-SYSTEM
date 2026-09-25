const { getLogger } = require('./logger');

// Work that must not delay the answer or change it, for example an email whose sending time would
// otherwise tell the caller whether an account exists. Failures are logged, never thrown.
//
// It runs once the response is over, however that happens: 'finish' after a normal answer, 'close'
// when the caller hangs up first (then 'finish' never comes), or straight away when the response
// was already over before the task was registered. A caller must not be able to cancel a security
// notice by dropping the connection.
const isOver = (res) => Boolean(res.writableFinished || res.destroyed || res.closed);

const afterResponse = (res, task) => {
    let started = false;
    const run = () => {
        if (started) return;
        started = true;
        Promise.resolve()
            .then(task)
            .catch((err) => getLogger().warn({ err }, 'Deferred task failed'));
    };
    if (isOver(res)) {
        run();
        return;
    }
    res.once('finish', run);
    res.once('close', run);
};

module.exports = { afterResponse };

// Every job type and its queue. The API reads this to enqueue without loading any handler.
module.exports = Object.freeze({
  report_filed: 'email',
  status_update: 'email',
  password_reset_request: 'email',
  password_changed: 'email',
});

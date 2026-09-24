const mongoose = require('mongoose');
const { captureLogs } = require('../helpers/captureLogs');

describe('database connection settings', () => {
  let logs;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => {
    logs.restore();
    vi.unstubAllEnvs();
    mongoose.set('autoIndex', true);
  });

  it.each([['production', false], ['development', true], ['test', true]])('NODE_ENV=%s sets autoIndex to %s', async (env, expected) => {
    vi.stubEnv('NODE_ENV', env);
    vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    const connectDB = require('../../config/db');
    await connectDB();
    expect(mongoose.get('autoIndex')).toBe(expected);
  });
});

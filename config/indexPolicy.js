// Production builds indexes deliberately (`npm run db:indexes -- --apply`) and its readiness check
// refuses traffic while a unique index is missing. Anything that loads the models against a
// production database (the app, migrations, admin scripts) must not build them as a side effect.
const applyIndexPolicy = (mongoose, env = process.env) => {
    mongoose.set('autoIndex', env.NODE_ENV !== 'production');
};

module.exports = { applyIndexPolicy };

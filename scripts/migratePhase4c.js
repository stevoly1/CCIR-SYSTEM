// npm run migrate:phase4c -- --dry-run | --verify | --apply --backup-reference=<name>
const mongoose = require('mongoose');
const { applyIndexPolicy } = require('../config/indexPolicy');
const { AccountToken, Complaint, User } = require('../models');
const { parseMigrationArgs } = require('./migratePhase1');

// Phase 4c, first part. Google has verified its accounts' addresses, so they count as verified;
// email-and-password accounts verify themselves (a link is sent when they ask from the dashboard).
// Unused email-change links from before the email-change record existed can no longer be confirmed,
// so they are removed; those people ask again. A missing field matches null in MongoDB, which is
// what older documents have.
const GOOGLE_UNVERIFIED = { authProvider: 'google', emailVerifiedAt: null };
const LEGACY_LINKS = { purpose: 'email_change', usedAt: null, emailChange: { $exists: false } };
// Part two gives reports written before background classification the state the new code reads.
// Equality to null matches both absent and explicitly null legacy fields.
const REPORTS_TO_MARK = { 'ai.status': null };
const failed = { $ne: [{ $ifNull: ['$ai.error', null] }, null] };
const MARK_REPORTS = [{
  $set: {
    categorySource: { $ifNull: ['$categorySource', { $cond: [failed, 'FALLBACK', 'AI'] }] },
    'ai.status': { $cond: [failed, 'FAILED', 'DONE'] },
    'ai.requestSeq': { $ifNull: ['$ai.requestSeq', 1] },
    'ai.failureCode': {
      $cond: [failed, {
        $switch: {
          branches: [
            { case: { $eq: ['$ai.error', 'TIMEOUT'] }, then: 'TIMEOUT' },
            { case: { $eq: ['$ai.error', 'INVALID_OUTPUT'] }, then: 'INVALID_OUTPUT' },
          ],
          default: 'PROVIDER_DOWN',
        },
      }, '$$REMOVE'],
    },
    'ai.failedAt': { $cond: [failed, { $ifNull: ['$ai.classifiedAt', '$createdAt'] }, '$$REMOVE'] },
    'ai.provider': { $cond: [{ $and: [{ $not: [failed] }, { $ne: [{ $ifNull: ['$ai.classifiedAt', null] }, null] }] }, 'gemini', '$$REMOVE'] },
  },
}];

const counts = async () => ({
  googleAccountsToVerify: await User.collection.countDocuments(GOOGLE_UNVERIFIED),
  legacyEmailChangeLinks: await AccountToken.collection.countDocuments(LEGACY_LINKS),
  reportsWithoutClassificationState: await Complaint.collection.countDocuments(REPORTS_TO_MARK),
});

const totalOf = (changes) => Object.values(changes).reduce((sum, n) => sum + n, 0);

const verify = async () => {
  const { googleAccountsToVerify, legacyEmailChangeLinks, reportsWithoutClassificationState } = await counts();
  const invariantFailures = [];
  if (googleAccountsToVerify) invariantFailures.push({ invariant: 'GOOGLE_ACCOUNT_UNVERIFIED', count: googleAccountsToVerify });
  if (legacyEmailChangeLinks) invariantFailures.push({ invariant: 'LEGACY_EMAIL_CHANGE_LINK', count: legacyEmailChangeLinks });
  if (reportsWithoutClassificationState) invariantFailures.push({ invariant: 'REPORT_WITHOUT_CLASSIFICATION_STATE', count: reportsWithoutClassificationState });
  return { mode: 'verify', invariantFailures, totalChanges: 0 };
};

const runPhase4cMigration = async ({ mode, backupReference }) => {
  if (mode === 'verify') return verify();
  if (!['dry-run', 'apply'].includes(mode)) throw new Error(`Unsupported migration mode: ${mode}`);
  if (mode === 'apply' && !backupReference) throw new Error('Apply requires a backup reference');
  const changes = await counts();
  if (mode === 'apply') {
    // The account's creation time, when known, as the moment Google had verified it.
    await User.collection.updateMany(GOOGLE_UNVERIFIED, [{ $set: { emailVerifiedAt: { $ifNull: ['$createdAt', '$$NOW'] } } }]);
    await AccountToken.collection.deleteMany(LEGACY_LINKS);
    await Complaint.collection.updateMany(REPORTS_TO_MARK, MARK_REPORTS);
  }
  return { mode, ...(backupReference ? { backupReference } : {}), changes, totalChanges: totalOf(changes) };
};

const runCli = async () => {
  // Quiet: stdout carries only the JSON report, so dotenv's banner must not reach it.
  require('dotenv').config({ quiet: true });
  const options = parseMigrationArgs(process.argv.slice(2));
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is required');
  // Connect directly rather than through config/db, whose connection log would reach stdout.
  applyIndexPolicy(mongoose);
  await mongoose.connect(process.env.MONGO_URL);
  try {
    const report = await runPhase4cMigration(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    // A failed verify must stop a deploy script, so it exits non-zero (2, distinct from errors).
    if (report.mode === 'verify' && report.invariantFailures.length) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runPhase4cMigration };

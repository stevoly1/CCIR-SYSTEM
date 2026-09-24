const mongoose = require('mongoose');
const Complaint = require('../../models/Complaint');
const { createComplaintFixture } = require('../fixtures/complaint');
const { createUserFixture } = require('../fixtures/user');

const indexNamesIn = (stage, names = []) => {
  if (!stage) return names;
  if (stage.indexName) names.push(stage.indexName);
  indexNamesIn(stage.inputStage, names);
  (stage.inputStages || []).forEach((child) => indexNamesIn(child, names));
  if (stage.queryPlan) indexNamesIn(stage.queryPlan, names);
  return names;
};
const winningIndexes = async (query) => indexNamesIn((await query.explain('queryPlanner')).queryPlanner.winningPlan);

describe('complaint indexes', () => {
  beforeEach(async () => {
    await Complaint.syncIndexes();
    for (let i = 0; i < 3; i += 1) await createComplaintFixture();
  });

  it('serves the staff list, newest first, from the createdAt index', async () => {
    expect(await winningIndexes(Complaint.find({}).sort({ createdAt: -1 }).limit(20))).toContain('createdAt_-1');
  });

  it('serves "Assigned to me" from the assignee index', async () => {
    const staff = await createUserFixture({ role: 'agency' });
    expect(await winningIndexes(Complaint.find({ assignedTo: staff._id }).sort({ createdAt: -1 }))).toContain('assignedTo_1_createdAt_-1');
  });

  it('serves the category filter and the category-in-use check from the category index', async () => {
    expect(await winningIndexes(Complaint.find({ category: new mongoose.Types.ObjectId() }))).toContain('category_1');
  });

  it('serves the citizen list from the reporter index', async () => {
    expect(await winningIndexes(Complaint.find({ reporter: new mongoose.Types.ObjectId() }).sort({ createdAt: -1 }))).toContain('reporter_1_createdAt_-1');
  });

  it('no longer declares the unused coordinate index', () => {
    const declared = Complaint.schema.indexes().map(([fields]) => Object.keys(fields).join(','));
    expect(declared).not.toContain('location.latitude,location.longitude');
  });
});

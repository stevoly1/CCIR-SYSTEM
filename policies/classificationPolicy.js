const FALLBACK_NAME = 'Other';
const AI_MAY_SET = new Set(['PENDING', 'FALLBACK', 'AI', null]);

// The filter guards the request sequence and both human-editable sources observed before the
// provider call. A later citizen or staff decision cannot be overwritten by an older result.
const decideClassification = ({ report, requestSeq, result, categories, inputMode, threshold, now }) => {
  const byName = new Map(categories.map((category) => [category.name, category]));
  const aiCategory = byName.get(result.category) ?? byName.get(FALLBACK_NAME);
  if (!aiCategory) throw new Error('Active Other category is not configured');
  const source = report.categorySource ?? null;
  const $set = {
    'ai.status': 'DONE',
    'ai.suggestedCategory': result.category,
    'ai.confidence': result.confidence,
    'ai.summary': result.summary,
    'ai.tags': result.tags,
    'ai.classifiedAt': now,
    'ai.provider': result.meta.provider,
    'ai.model': result.meta.model,
    'ai.promptVersion': result.meta.promptVersion,
    'ai.inputMode': inputMode,
  };
  const $unset = { 'ai.failureCode': 1, 'ai.failedAt': 1, 'ai.error': 1, 'ai.processingToken': 1 };

  if (AI_MAY_SET.has(source)) {
    Object.assign($set, {
      category: aiCategory._id,
      categorySnapshot: { categoryId: aiCategory._id, name: aiCategory.name },
      categorySource: 'AI',
    });
    $unset['ai.disagreement'] = 1;
  } else if (source === 'CITIZEN') {
    const differs = String(aiCategory._id) !== String(report.category);
    if (differs && result.confidence >= threshold) {
      $set['ai.disagreement'] = { categoryId: aiCategory._id, name: aiCategory.name, confidence: result.confidence };
    } else {
      $unset['ai.disagreement'] = 1;
    }
  } else if (source === 'STAFF') {
    $unset['ai.disagreement'] = 1;
  }
  if (report.prioritySource !== 'STAFF') Object.assign($set, { priority: result.priority, prioritySource: 'AI' });

  return {
    filter: { _id: report._id, status: { $ne: 'WITHDRAWN' }, 'ai.status': 'PENDING', 'ai.requestSeq': requestSeq,
      ...(report.ai?.processingToken ? { 'ai.processingToken': report.ai.processingToken } : {}),
      categorySource: source, prioritySource: report.prioritySource ?? null },
    update: { $set, $unset },
  };
};

module.exports = { decideClassification, FALLBACK_NAME };

import { useState } from 'react';
import RecategoriseDialog from './RecategoriseDialog';

// Staff settle the difference between the citizen's choice and the AI suggestion.
const DisagreementPanel = ({ complaint, onUpdated, onConflict }) => {
    const [choice, setChoice] = useState(null);
    const disagreement = complaint.ai?.disagreement;
    if (complaint.ai?.status !== 'DONE' || !disagreement || !complaint.canRecategorise) return null;
    return (
        <div className="field" role="region" aria-label="AI disagreement">
            <p><strong>{`AI suggests ${disagreement.name} (${Math.round(disagreement.confidence * 100)}%)`}</strong> — the citizen chose {complaint.category.name}.</p>
            <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-primary" onClick={() => setChoice({ id: disagreement.categoryId, title: "Use the AI's category" })}>Use AI's category</button>
                <button type="button" className="btn btn-outline" onClick={() => setChoice({ id: complaint.category._id, title: "Keep the citizen's category" })}>Keep citizen's category</button>
            </div>
            {choice && (
                <RecategoriseDialog complaint={complaint} initialCategoryId={choice.id} title={choice.title}
                    onClose={() => setChoice(null)}
                    onDone={() => { setChoice(null); onUpdated(); }}
                    onConflict={() => { setChoice(null); onConflict(); }} />
            )}
        </div>
    );
};

export default DisagreementPanel;

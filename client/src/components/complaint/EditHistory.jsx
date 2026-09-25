// Staff only: what the reporter changed while the report was pending, and whether the AI
// re-analysed it. Entries come from the staff view's `editHistory`.
const FIELD_LABELS = { description: 'description', location: 'location' };

const describeFields = (fields) => {
    const names = fields.map((field) => FIELD_LABELS[field] ?? field);
    const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? 'report';
    return text.charAt(0).toUpperCase() + text.slice(1);
};

const EditHistory = ({ entries }) => {
    if (!entries?.length) return null;
    return (
        <>
            <div className="section-header" style={{ marginTop: 28 }}><h2>Reporter's edits</h2></div>
            <ul className="edit-history" aria-label="Reporter's edits">
                {entries.map((entry, index) => (
                    <li key={`${entry.editedAt}-${index}`} className="meta">
                        {`${describeFields(entry.fields)} changed by ${entry.editedBy?.displayName ?? 'the reporter'}`}
                        {` · ${new Date(entry.editedAt).toLocaleString()}`}
                        {entry.reanalysed && ' · re-analysed by the AI'}
                    </li>
                ))}
            </ul>
        </>
    );
};

export default EditHistory;

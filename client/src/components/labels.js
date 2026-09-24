// Words shown for stored codes; the codes themselves are what the API sends and receives.
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const PRIORITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

export const STATUS_LABELS = {
    PENDING: 'Pending',
    IN_REVIEW: 'In Review',
    IN_PROGRESS: 'In Progress',
    RESOLVED: 'Resolved',
    REJECTED: 'Rejected',
    WITHDRAWN: 'Withdrawn',
};

export const COORDINATE_SOURCE_LABELS = {
    DEVICE: "from the reporter's device",
    SUGGESTION: 'from an address suggestion',
};

export const labelFor = (labels, code) => labels[code] ?? code;

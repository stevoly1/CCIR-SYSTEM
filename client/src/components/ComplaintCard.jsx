import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff } from 'lucide-react';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';

const timeAgo = (dateString) => {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateString).toLocaleDateString();
};

const ComplaintCard = ({ complaint }) => {
    const navigate = useNavigate();

    return (
        <div className="complaint-card" role="button" onClick={() => navigate(`/dashboard/reports/${complaint._id}`)}>
            {complaint.images?.[0]?.url ? (
                <img className="complaint-thumb" src={complaint.images[0].url} alt="" />
            ) : (
                <div className="complaint-thumb"><ImageOff size={20} /></div>
            )}
            <div className="complaint-info">
                <div className="ref">{complaint.referenceCode}</div>
                <div className="desc">{complaint.description}</div>
                <div className="meta">
                    <span>{complaint.category?.name || 'Uncategorized'}</span>
                    <span className="meta-dot">&middot;</span>
                    <span>{complaint.location?.address || 'No location'}</span>
                    <span className="meta-dot">&middot;</span>
                    <span>{timeAgo(complaint.createdAt)}</span>
                </div>
            </div>
            <div className="complaint-badges">
                <StatusBadge status={complaint.status} />
                <PriorityBadge priority={complaint.priority} />
            </div>
        </div>
    );
};

export default ComplaintCard;

import React from 'react';
import { useNavigate } from 'react-router-dom';

const QuickActionCard = ({ icon, title, description, to, variant }) => {
    const navigate = useNavigate();

    return (
        <button className={`quick-action-card qa-${variant}`} onClick={() => navigate(to)}>
            <span className="qa-icon">{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </button>
    );
};

export default QuickActionCard;

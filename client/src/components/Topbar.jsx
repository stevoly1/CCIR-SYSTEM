// Page heading. The notifications bell was removed until real notifications exist.
const Topbar = ({ title, subtitle, actions }) => (
    <div className="topbar">
        <div className="topbar-heading">
            <h1>{title}</h1>
            {subtitle && <p style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>{subtitle}</p>}
        </div>
        {actions && <div className="topbar-actions">{actions}</div>}
    </div>
);

export default Topbar;

// One-time links carry their token after # (the browser never sends that part to a server). Reading
// is pure, so React may call it twice in development; the fragment is removed separately.
export const readLinkToken = (hash) => {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]+)(?:&|$)/.exec(hash || '');
    return match ? match[1] : null;
};

export const clearLinkFragment = () => {
    if (window.location.hash) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
};

// Where to go after signing in: the dashboard page that sent the visitor to sign in (kept in
// router state by ProtectedRoute), or the dashboard itself. Nothing outside the dashboard.
export const returnPath = (state) => {
    const from = state?.from;
    return typeof from === 'string' && /^\/dashboard(?:$|[/?#])/.test(from) ? from : '/dashboard';
};

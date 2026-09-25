// Leaves the app with a full page load, dropping everything held in memory. Used after deleting
// the account: a router navigation would race the guard that sends a signed-out user to sign in.
export const leaveTo = (path) => window.location.replace(path);

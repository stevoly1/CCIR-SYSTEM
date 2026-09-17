const SCOPES = ['openid', 'email', 'profile'].join(' ');

const config = () => ({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_CALLBACK_URL,
});

const isConfigured = () => {
    const { clientId, clientSecret, redirectUri } = config();
    return Boolean(clientId && clientSecret && redirectUri);
};

const buildAuthUrl = (state) => {
    const { clientId, redirectUri } = config();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
};

// Exchanges an authorization code for tokens, then fetches the Google profile in one step.
const exchangeCodeForProfile = async (code) => {
    const { clientId, clientSecret, redirectUri } = config();

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
        throw new Error(`Google token exchange failed: ${tokenData.error_description || tokenData.error}`);
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profile = await profileResponse.json();
    if (!profileResponse.ok) {
        throw new Error('Failed to fetch Google profile');
    }

    return {
        googleId: profile.sub,
        email: profile.email,
        emailVerified: profile.email_verified,
        name: profile.name,
        avatarUrl: profile.picture,
    };
};

module.exports = { isConfigured, buildAuthUrl, exchangeCodeForProfile };

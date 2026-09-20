const SCOPES = ['openid', 'email', 'profile'].join(' ');

class GoogleOAuthError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

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
    try {
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
        if (!tokenResponse.ok || typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
            throw new GoogleOAuthError('TOKEN_EXCHANGE_FAILED');
        }

        const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileResponse.json();
        if (!profileResponse.ok) throw new GoogleOAuthError('PROFILE_FETCH_FAILED');

        return {
            googleId: profile.sub,
            email: profile.email,
            emailVerified: profile.email_verified,
            name: profile.name,
            avatarUrl: profile.picture,
        };
    } catch (error) {
        if (error instanceof GoogleOAuthError) throw error;
        throw new GoogleOAuthError('PROVIDER_ERROR');
    }
};

module.exports = { GoogleOAuthError, isConfigured, buildAuthUrl, exchangeCodeForProfile };

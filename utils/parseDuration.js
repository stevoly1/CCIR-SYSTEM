const UNIT_MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

// Parses short duration strings like "15m", "7d" (as used by JWT_*_LIFESPAN env vars) into milliseconds.
const parseDuration = (value) => {
    const match = /^(\d+)(s|m|h|d)$/.exec(String(value).trim());
    if (!match) {
        throw new Error(`Invalid duration string: ${value}`);
    }
    const [, amount, unit] = match;
    return Number(amount) * UNIT_MS[unit];
};

module.exports = parseDuration;

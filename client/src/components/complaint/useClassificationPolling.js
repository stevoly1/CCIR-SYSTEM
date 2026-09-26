import { useCallback, useEffect, useRef, useState } from 'react';

// Refresh only while pending and visible. Never overlap requests; stop after the time limit.
export const useClassificationPolling = ({ pending, refresh, intervalMs = 3000, limitMs = 120000 }) => {
    const [stalled, setStalled] = useState(false);
    const [round, setRound] = useState(0);
    const [previousPending, setPreviousPending] = useState(pending);
    if (previousPending !== pending) {
        setPreviousPending(pending);
        setStalled(false);
    }
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; }, [refresh]);

    useEffect(() => {
        if (!pending) return undefined;
        const startedAt = Date.now();
        let timer = null;
        let stopped = false;
        let inFlight = false;
        const deadline = setTimeout(() => {
            stopped = true;
            clearTimeout(timer);
            setStalled(true);
        }, limitMs);
        const schedule = () => {
            if (stopped) return;
            timer = setTimeout(async () => {
                timer = null;
                if (Date.now() - startedAt >= limitMs) { setStalled(true); return; }
                if (document.visibilityState === 'hidden') { schedule(); return; }
                inFlight = true;
                try { await refreshRef.current(); } catch { /* Keep the report already on screen. */ }
                inFlight = false;
                schedule();
            }, intervalMs);
        };
        const onVisible = () => { if (document.visibilityState === 'visible' && !timer && !inFlight) schedule(); };
        schedule();
        document.addEventListener('visibilitychange', onVisible);
        return () => { stopped = true; clearTimeout(timer); clearTimeout(deadline); document.removeEventListener('visibilitychange', onVisible); };
    }, [pending, intervalMs, limitMs, round]);

    const restart = useCallback(() => { setStalled(false); setRound((value) => value + 1); }, []);
    return { stalled, restart };
};

import { act, renderHook } from '@testing-library/react';
import { useClassificationPolling } from './useClassificationPolling';

describe('refreshing a report while classification is pending', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('refreshes one request at a time and stops after two minutes until restarted', async () => {
        let finish;
        const refresh = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { result } = renderHook(() => useClassificationPolling({ pending: true, refresh }));
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalledTimes(1);
        await act(() => vi.advanceTimersByTimeAsync(6000));
        expect(refresh).toHaveBeenCalledTimes(1);
        await act(async () => { finish(); });
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalledTimes(2);
        await act(async () => { finish(); });
        refresh.mockResolvedValue(undefined);
        await act(() => vi.advanceTimersByTimeAsync(120000));
        expect(result.current.stalled).toBe(true);
        const calls = refresh.mock.calls.length;
        await act(() => vi.advanceTimersByTimeAsync(30000));
        expect(refresh).toHaveBeenCalledTimes(calls);
        await act(async () => { result.current.restart(); });
        expect(result.current.stalled).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalledTimes(calls + 1);
    });

    it('does not refresh when no request is pending or the page is hidden', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        const { rerender } = renderHook(({ pending }) => useClassificationPolling({ pending, refresh }), { initialProps: { pending: false } });
        await act(() => vi.advanceTimersByTimeAsync(9000));
        expect(refresh).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        rerender({ pending: true });
        await act(() => vi.advanceTimersByTimeAsync(9000));
        expect(refresh).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalled();
    });

    it('does not start another request when visibility changes during a refresh', async () => {
        let finish;
        const refresh = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        renderHook(() => useClassificationPolling({ pending: true, refresh }));
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalledTimes(1);
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(refresh).toHaveBeenCalledTimes(1);
        await act(async () => { finish(); });
    });

    it('reports a stall at the limit even when a refresh never settles', async () => {
        const refresh = vi.fn(() => new Promise(() => {}));
        const { result } = renderHook(() => useClassificationPolling({ pending: true, refresh }));
        await act(() => vi.advanceTimersByTimeAsync(120000));
        expect(result.current.stalled).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('clears the old stall when a new classification request begins', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        const { result, rerender } = renderHook(({ pending }) => useClassificationPolling({ pending, refresh, intervalMs: 10, limitMs: 30 }), { initialProps: { pending: true } });
        await act(() => vi.advanceTimersByTimeAsync(30));
        expect(result.current.stalled).toBe(true);
        rerender({ pending: false });
        rerender({ pending: true });
        expect(result.current.stalled).toBe(false);
    });
});

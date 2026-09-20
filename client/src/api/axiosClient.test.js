import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './axiosClient';

describe('extractErrorMessage', () => {
  it.each([
    [{ response: { data: { error: { message: 'Canonical message' }, msg: 'Legacy message' } } }, 'Canonical message'],
    [{ response: { data: { msg: 'Legacy message' } } }, 'Legacy message'],
    [{ message: 'Network message' }, 'Network message'],
    [{}, 'Something went wrong'],
  ])('uses the safest available compatible message', (error, expected) => {
    expect(extractErrorMessage(error)).toBe(expected);
  });
});

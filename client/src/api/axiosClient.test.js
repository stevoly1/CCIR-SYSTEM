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

  it('shows the field reasons of a validation error instead of its generic message', () => {
    const error = { response: { data: { error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [
        { path: 'body.name', code: 'INVALID_VALUE', message: 'Name must be at least 2 characters long' },
        { path: 'body.password', code: 'INVALID_VALUE', message: 'Password must be at least 6 characters long' },
        { path: 'body.name', code: 'INVALID_VALUE', message: 'Name must be at least 2 characters long' },
      ],
    } } } };
    expect(extractErrorMessage(error)).toBe('Name must be at least 2 characters long. Password must be at least 6 characters long');
  });

  it('falls back to the error message when details carry no usable text', () => {
    const error = { response: { data: { error: { message: 'Request validation failed', details: [{ path: 'body' }, 'x'] } } } };
    expect(extractErrorMessage(error)).toBe('Request validation failed');
  });
});

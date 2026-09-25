import { render, screen } from '@testing-library/react';
import GoogleButton from './GoogleButton';

describe('GoogleButton', () => {
  const href = () => screen.getByRole('link', { name: /continue with google/i }).getAttribute('href');

  it('carries a dashboard return path, encoded', () => {
    render(<GoogleButton returnTo="/dashboard/reports/66f1a0c0a1b2c3d4e5f60001" />);
    expect(href()).toMatch(/\/auth\/google\?returnTo=%2Fdashboard%2Freports%2F66f1a0c0a1b2c3d4e5f60001$/);
  });

  it('leaves out the plain dashboard and anything else', () => {
    render(<GoogleButton returnTo="/dashboard" />);
    expect(href()).toMatch(/\/auth\/google$/);
  });
});

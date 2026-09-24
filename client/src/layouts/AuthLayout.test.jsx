import { render } from '@testing-library/react';
import AuthLayout from './AuthLayout';

describe('AuthLayout', () => {
    // The hero (with its brand) is hidden on phones, so the form panel carries its own.
    it('shows the app name above the form, not only in the hero', () => {
        const { container } = render(<AuthLayout><form aria-label="sign in" /></AuthLayout>);
        const panelBrand = container.querySelector('.auth-panel .auth-mobile-brand');
        expect(panelBrand).toHaveTextContent('CCIR System');
        expect(panelBrand.querySelector('img')).toHaveAttribute('alt', '');
    });
});

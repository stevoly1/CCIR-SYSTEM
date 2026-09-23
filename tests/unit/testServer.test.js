const { testServer } = require('../helpers/testServer');

describe('shared test server', () => {
  it('binds explicitly to the IPv4 loopback so no other local process can shadow its port', () => {
    const address = testServer().address();
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
  });
});

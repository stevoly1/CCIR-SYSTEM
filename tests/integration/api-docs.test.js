const request = require('supertest');
const { testServer } = require('../helpers/testServer');

describe('API documentation page', () => {
  it('serves the page and its assets from this server, never a CDN', async () => {
    const page = await request(testServer()).get('/api/v1/docs');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('/api/v1/docs/assets/swagger-ui-bundle.js');
    expect(page.text).not.toMatch(/https?:\/\//);
    expect(page.text).not.toMatch(/<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>/); // no inline script
    for (const asset of ['/api/v1/docs/assets/swagger-ui-bundle.js', '/api/v1/docs/assets/swagger-ui.css', '/api/v1/docs/init.js']) {
      expect((await request(testServer()).get(asset)).status).toBe(200);
    }
  });

  // swagger-ui-dist also ships a stock petstore page, an OAuth redirect page and source maps; only
  // the two files this page uses are served.
  it.each(['index.html', 'oauth2-redirect.html', 'swagger-initializer.js', 'swagger-ui-bundle.js.map', 'swagger-ui.js', 'package.json'])(
    'does not serve the unused swagger-ui-dist file %s',
    async (file) => {
      expect((await request(testServer()).get(`/api/v1/docs/assets/${file}`)).status).toBe(404);
    },
  );

  it('runs under the application\'s own security policy: scripts from this server only', async () => {
    const page = await request(testServer()).get('/api/v1/docs');
    const health = await request(testServer()).get('/api/v1/health/live');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toBe(health.headers['content-security-policy']);
    expect(page.headers['content-security-policy']).toMatch(/script-src 'self'(;|$)/);
    expect(page.headers['content-security-policy']).not.toMatch(/unsafe-eval/);
  });

  it('returns the JSON 404 when API_DOCS_UI=false, while the JSON contract stays available', async () => {
    vi.stubEnv('API_DOCS_UI', 'false');
    const page = await request(testServer()).get('/api/v1/docs');
    expect(page.status).toBe(404);
    expect(page.body.error.code).toBe('NOT_FOUND');
    expect((await request(testServer()).get('/api/v1/docs/assets/swagger-ui-bundle.js')).status).toBe(404);
    expect((await request(testServer()).get('/api/v1/openapi.json')).status).toBe(200);
  });
});

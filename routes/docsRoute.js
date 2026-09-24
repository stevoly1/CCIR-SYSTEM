const path = require('node:path');
const express = require('express');
// absolute-path gives the asset folder without evaluating the browser bundle.
const swaggerUiPath = require('swagger-ui-dist/absolute-path');

const DOCS_DIR = path.resolve(__dirname, '..', 'openapi', 'docs');
const DocsRouter = express.Router();

// API_DOCS_UI=false turns the page off; the JSON contract at /api/v1/openapi.json stays on.
// The page runs under the application's own security policy (scripts from this server only).
DocsRouter.use((req, res, next) => (process.env.API_DOCS_UI === 'false' ? next('router') : next()));
DocsRouter.use('/assets', express.static(swaggerUiPath(), { index: false }));
DocsRouter.get('/init.js', (req, res) => res.sendFile('init.js', { root: DOCS_DIR }));
DocsRouter.get('/', (req, res) => res.sendFile('index.html', { root: DOCS_DIR }));

module.exports = DocsRouter;

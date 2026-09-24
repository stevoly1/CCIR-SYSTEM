const fs = require('fs');
const express = require('express');

const isApiPath = (requestPath) => requestPath === '/api' || requestPath.startsWith('/api/');

// Serves the built reference client (client/dist), if present. Client routes get the app shell;
// API paths never do, so an unknown API route still reaches the JSON 404 handler.
const mountReferenceClient = (app, clientDist) => {
  if (!fs.existsSync(clientDist)) return;
  app.use(express.static(clientDist));
  // Express 5 (path-to-regexp v8) requires a named wildcard, not a bare '*'.
  app.get('/*splat', (req, res, next) => {
    if (isApiPath(req.path)) return next();
    // `root` keeps the hidden-file check to the file name, so an install path with a hidden
    // folder (for example /home/app/.deploy/ccir) still serves the shell.
    // A missing shell falls through to the JSON 404; any other failure is a real error.
    return res.sendFile('index.html', { root: clientDist }, (error) => {
      if (!error) return undefined;
      return error.statusCode === 404 ? next() : next(error);
    });
  });
};

module.exports = { mountReferenceClient };

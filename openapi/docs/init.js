// Kept in its own file so the page needs no inline script under the application's policy.
window.addEventListener('load', () => {
  window.ui = window.SwaggerUIBundle({
    url: '/api/v1/openapi.json',
    dom_id: '#swagger-ui',
    withCredentials: true,
  });
});

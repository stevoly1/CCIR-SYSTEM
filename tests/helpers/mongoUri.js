// Points a MongoDB connection string at a named database, keeping host and options.
const withDatabase = (uri, name) => {
  const url = new URL(uri);
  url.pathname = `/${name}`;
  return url.toString();
};

module.exports = { withDatabase };

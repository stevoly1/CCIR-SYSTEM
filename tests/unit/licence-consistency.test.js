const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('licence declaration', () => {
  const licenceText = read('LICENSE');
  const declared = licenceText.startsWith('MIT License') ? 'MIT' : null;

  it('names a recognised licence in LICENSE', () => {
    expect(declared).toBe('MIT');
  });

  it.each(['package.json', 'client/package.json'])('%s declares the same licence as LICENSE', (file) => {
    expect(JSON.parse(read(file)).license).toBe(declared);
  });

  it('keeps the reference client unpublishable', () => {
    expect(JSON.parse(read('client/package.json')).private).toBe(true);
  });
});

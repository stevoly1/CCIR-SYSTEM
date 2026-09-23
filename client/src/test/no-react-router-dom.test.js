import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

describe('router package', () => {
  // Covers imports and vi.mock() targets: a mock of the old package silently stops applying.
  it('imports and mocks routing only as react-router', () => {
    const oldPackage = /(from\s+|vi\.mock\(\s*|import\(\s*|require\(\s*)['"]react-router-dom['"]/;
    const offenders = walk('src').filter((file) => /\.(jsx?|tsx?)$/.test(file)
      && oldPackage.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('does not depend on react-router-dom', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['react-router-dom']).toBeUndefined();
    expect(pkg.devDependencies?.['react-router-dom']).toBeUndefined();
    expect(pkg.dependencies['react-router']).toBeDefined();
  });
});

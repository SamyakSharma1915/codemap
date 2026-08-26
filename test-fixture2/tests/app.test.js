import test from 'node:test';
import assert from 'node:assert';
import App from '../src/index.js';

test('app initializes', async () => {
  const app = new App(3000);
  await app.initialize();
  assert.ok(app.server);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../src/server.js';

test('Socket.IO polling does not double-handle HTTP requests or break race creation', async () => {
  const service = await startServer({
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    backupDir: 'unused',
    frontendDist: 'unused',
    serveFrontend: false,
    sidecar: false,
  });
  const baseUrl = service.baseUrl;

  try {
    const handshake = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=workflow-test`);
    assert.equal(handshake.status, 200);
    assert.match(await handshake.text(), /^0\{"sid":/);

    const created = await fetch(`${baseUrl}/api/races`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Socket Workflow', raceDate: '2026-10-24' }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).name, 'Socket Workflow');

    const list = await fetch(`${baseUrl}/api/races`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).length, 1);
  } finally {
    service.io.disconnectSockets(true);
    await service.close();
  }
});

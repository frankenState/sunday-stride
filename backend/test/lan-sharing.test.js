import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivateIpv4, selectLanIpv4 } from '../src/network/lanAddress.js';
import { createPublicApiRouter } from '../src/routes/publicApi.js';
import { createPublicApp } from '../src/publicApp.js';
import { createApiRouter } from '../src/routes/api.js';
import { createRaceService } from '../src/services/raceService.js';
import { getPublicLeaderboard } from '../src/services/publicLeaderboard.js';
import { openDatabase } from '../src/database/initialize.js';
import { createRaceEventPublisher } from '../src/socket/raceEvents.js';

test('LAN address selection picks a private IPv4 address and skips non-private adapters', () => {
  assert.equal(isPrivateIpv4('192.168.1.22'), true);
  assert.equal(isPrivateIpv4('10.0.0.4'), true);
  assert.equal(isPrivateIpv4('172.31.4.5'), true);
  assert.equal(isPrivateIpv4('172.32.4.5'), false);
  assert.equal(isPrivateIpv4('169.254.1.3'), false);
  assert.equal(isPrivateIpv4('127.0.0.1'), false);
  const interfaces = {
    loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    linkLocal: [{ family: 4, address: '169.254.2.2', internal: false }],
    public: [{ family: 'IPv4', address: '8.8.8.8', internal: false }],
    wifi: [{ family: 'IPv4', address: '192.168.1.22', internal: false }],
  };
  assert.equal(selectLanIpv4(interfaces), '192.168.1.22');
  assert.equal(selectLanIpv4({ loopback: interfaces.loopback, public: interfaces.public }), null);
});

test('public leaderboard data is race-scoped and omits runner IDs and registration data', () => {
  const db = openDatabase({ databasePath: ':memory:', backupDir: 'unused', logger: { info() {} } });
  const races = createRaceService(db);
  try {
    const first = races.createRace({ name: 'Public 5K' });
    races.importRoster(first.id, { csv: 'secret-bib,Runner One,Men-5k\nsecret-bib-2,Runner Two,Women-3k', commit: true });
    races.addCategory(first.id, 'Open-5k');
    races.startRace(first.id);
    races.recordFinish(first.id, 'secret-bib');
    const second = races.createRace({ name: 'Private History' });
    races.importRoster(second.id, { csv: 'other-bib,Other Runner,Open-10k', commit: true });

    const board = getPublicLeaderboard(db, first.id);
    assert.equal(board.race.name, 'Public 5K');
    assert.equal(board.race.status, 'running');
    assert.deepEqual(board.categories, ['Men-5k', 'Open-5k', 'Women-3k']);
    assert.deepEqual(board.finishes, [{ name: 'Runner One', category: 'Men-5k', finishedAt: board.finishes[0].finishedAt }]);
    assert.equal(Object.hasOwn(board.finishes[0], 'idKey'), false);
    assert.equal(JSON.stringify(board).includes('secret-bib'), false);
    assert.throws(() => getPublicLeaderboard(db, second.id + 100), { status: 404 });

    const publicRouter = createPublicApiRouter(db);
    const leaderboardRoute = publicRouter.stack.find((layer) => layer.route?.path === '/races/:raceId/leaderboard');
    assert.ok(leaderboardRoute);
    assert.deepEqual(Object.keys(leaderboardRoute.route.methods), ['get']);

    const publicApp = createPublicApp({ db, frontendDist: 'unused-in-tests' });
    const appLayers = publicApp.router.stack;
    const apiRouterLayer = appLayers.find((layer) => layer.name === 'router');
    assert.ok(apiRouterLayer, 'public app mounts its dedicated public API router');
    assert.deepEqual(apiRouterLayer.handle.stack.map((layer) => ({
      path: layer.route?.path,
      methods: Object.keys(layer.route?.methods ?? {}),
    })), [{ path: '/races/:raceId/leaderboard', methods: ['get'] }]);
    assert.equal(appLayers.some((layer) => layer.route?.path?.startsWith('/api')), false,
      'public app does not register management API routes');
  } finally {
    db.close();
  }
});

test('public socket notifications reveal only the changed race ID', () => {
  const privateEvents = [];
  const publicEvents = [];
  const publisher = createRaceEventPublisher();
  publisher.attach({ emit: (...args) => privateEvents.push(args) });
  publisher.attachPublic({ to: (room) => ({ emit: (...args) => publicEvents.push([room, ...args]) }) });
  publisher.publish('runner:finished', '42', { runner: { name: 'Runner One' } });
  assert.deepEqual(privateEvents, [['runner:finished', { raceId: 42, runner: { name: 'Runner One' } }]]);
  assert.deepEqual(publicEvents, [['public-race:42', 'leaderboard:changed', { raceId: 42 }]]);
});

test('loopback share endpoint reports the public listener URL and is not part of the public API', () => {
  const db = openDatabase({ databasePath: ':memory:', backupDir: 'unused', logger: { info() {} } });
  try {
    const managementRouter = createApiRouter({
      db,
      getPublicBaseUrl: () => 'http://192.168.1.20:41000',
    });
    const shareRoute = managementRouter.stack.find((layer) => layer.route?.path === '/server/share');
    assert.ok(shareRoute);
    assert.deepEqual(Object.keys(shareRoute.route.methods), ['get']);
    let payload;
    shareRoute.route.stack[0].handle({}, { json: (value) => { payload = value; } });
    assert.deepEqual(payload, { publicBaseUrl: 'http://192.168.1.20:41000' });

    const publicRouter = createPublicApiRouter(db);
    assert.equal(publicRouter.stack.some((layer) => layer.route?.path === '/server/share'), false);
  } finally {
    db.close();
  }
});

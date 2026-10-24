import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createPublicApp } from './publicApp.js';
import { readConfig } from './config.js';
import { openDatabase } from './database/initialize.js';
import { Server as SocketServer } from 'socket.io';
import { createRaceEventPublisher } from './socket/raceEvents.js';
import { selectLanIpv4 } from './network/lanAddress.js';

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return typeof address === 'object' && address ? address.port : port;
}

export async function startServer(config = readConfig()) {
  const db = openDatabase({ databasePath: config.databasePath, backupDir: config.backupDir, cleanStartToken: config.cleanStartToken });
  const publisher = createRaceEventPublisher();
  let publicBaseUrl = null;
  const app = createApp({
    db,
    emitRace: publisher.publish,
    getPublicBaseUrl: () => publicBaseUrl,
    frontendDist: config.frontendDist,
    serveFrontend: config.serveFrontend,
  });
  const server = http.createServer();
  const io = new SocketServer(server, { cors: { origin: true } });
  publisher.attach(io);
  server.on('request', (request, response) => {
    // Engine.IO owns its polling endpoint. Letting Express handle those same
    // requests creates a second response after Socket.IO has sent its packet.
    if (request.url?.startsWith('/socket.io/')) return;
    app(request, response);
  });

  let actualPort;
  try {
    actualPort = await listen(server, config.port, config.host);
  } catch (error) {
    io.close(); db.close(); throw error;
  }

  let publicIo = null;
  let publicServer = null;
  if (config.lanSharing && config.publicFrontendDist && fs.existsSync(path.join(config.publicFrontendDist, 'index.html'))) {
    const lanAddress = selectLanIpv4();
    if (lanAddress) {
      const publicApp = createPublicApp({ db, frontendDist: config.publicFrontendDist });
      publicServer = http.createServer();
      publicIo = new SocketServer(publicServer);
      publicServer.on('request', (request, response) => {
        if (request.url?.startsWith('/socket.io/')) return;
        publicApp(request, response);
      });
      publicIo.on('connection', (socket) => {
        const raceId = Number(socket.handshake.auth?.raceId);
        if (Number.isSafeInteger(raceId) && raceId > 0) socket.join(`public-race:${raceId}`);
      });
      try {
        const publicPort = await listen(publicServer, 0, lanAddress);
        publicBaseUrl = `http://${lanAddress}:${publicPort}`;
        publisher.attachPublic(publicIo);
        console.log(`Public race leaderboard listening on ${publicBaseUrl}`);
      } catch (error) {
        console.error(`LAN leaderboard sharing is unavailable: ${error.message}`);
        publicIo.close();
        publicIo = null;
        publicServer = null;
      }
    } else {
      console.warn('LAN leaderboard sharing is unavailable: no private IPv4 network address was found.');
    }
  }

  if (config.sidecar) process.stdout.write(`SIDECAR_READY:${JSON.stringify({ baseUrl: `http://${config.host}:${actualPort}`, publicBaseUrl })}\n`);
  console.log(`Race timing server listening on http://${config.host}:${actualPort}`);

  let stopping = false;
  const close = () => new Promise((resolve) => {
    if (stopping) return resolve();
    stopping = true;
    const closePrivate = () => io.close(() => { db.close(); resolve(); });
    if (publicIo) publicIo.close(closePrivate);
    else closePrivate();
  });
  return { app, db, io, server, publicIo, publicServer, baseUrl: `http://${config.host}:${actualPort}`, publicBaseUrl, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const config = readConfig();
  startServer(config).then(({ close }) => {
    const shutdown = () => { void close().finally(() => process.exit(0)); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}

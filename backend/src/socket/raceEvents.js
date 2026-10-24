export function createRaceEventPublisher() {
  let io = null;
  let publicIo = null;
  return {
    attach(socketServer) { io = socketServer; },
    attachPublic(socketServer) { publicIo = socketServer; },
    publish(event, raceId, data = {}) {
      const id = Number(raceId);
      io?.emit(event, { raceId: id, ...data });
      publicIo?.to(`public-race:${id}`).emit('leaderboard:changed', { raceId: id });
    },
  };
}

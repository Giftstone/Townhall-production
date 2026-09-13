let io = null;

function buildCorsOrigin() {
  const list = [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:3000', 'http://127.0.0.1:3000',
    process.env.FRONTEND_URL, process.env.CORS_ORIGIN, process.env.CLIENT_URL,
  ].filter(Boolean);
  if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.includes(',')) {
    process.env.CORS_ORIGIN.split(',').forEach((o) => {
      const t = o.trim();
      if (t && !list.includes(t)) list.push(t);
    });
  }
  return list;
}

function initRealtime(server) {
  let Server;
  try { ({ Server } = require('socket.io')); }
  catch { console.warn('socket.io not installed — realtime disabled'); return null; }

  io = new Server(server, { cors: { origin: buildCorsOrigin(), credentials: true } });
  io.on('connection', (socket) => {
    socket.on('identify', ({ userId, role }) => {
      if (userId) socket.join(`user:${userId}`);
      if (role) socket.join(`role:${role}`);
      socket.join('global');
    });
  });
  console.log('Real-time notifications ready (Socket.IO)');
  return io;
}

function getIO() { return io; }

function notify({ userId, roles, event = 'notification', payload } = {}) {
  if (!io) return;
  const data = payload || {};
  if (userId) io.to(`user:${userId}`).emit(event, data);
  if (Array.isArray(roles)) roles.forEach((role) => io.to(`role:${role}`).emit(event, data));
}

function emitToRole(role, event, payload) { if (io) io.to(`role:${role}`).emit(event, payload); }
function emitToUser(userId, event, payload) { if (io) io.to(`user:${userId}`).emit(event, payload); }
function emitGlobal(event, payload) { if (io) io.to('global').emit(event, payload); }

module.exports = { initRealtime, getIO, notify, emitToRole, emitToUser, emitGlobal };

// Discord Rich Presence over Discord's local IPC socket (no dependencies).
// Frames are: int32 LE opcode, int32 LE length, then that many bytes of JSON.
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15_000;
// Discord allows about 5 activity updates per 20 s; coalesce to stay under it.
const MIN_GAP_MS = 4_000;

function socketPaths() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const dirs = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, '/tmp'];
  return [...new Set(dirs.filter(Boolean))].flatMap((d) =>
    Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)),
  );
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

class DiscordPresence {
  constructor(clientId, log = () => {}) {
    this.clientId = clientId;
    this.log = log;
    this.socket = null;
    this.ready = false;
    this.wanted = null; // latest activity to show (null = clear)
    this.sentAt = 0;
    this.timer = null;
    this.retry = null;
    this.stopped = false;
    if (clientId) this.connect();
  }

  /** Show an activity, or clear it with null. Safe to call often. */
  set(activity) {
    this.wanted = activity;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    if (this.socket && this.ready) this.send(null);
    this.socket?.end();
  }

  connect(paths = socketPaths()) {
    if (this.stopped) return;
    const [next, ...rest] = paths;
    if (!next) {
      // Discord isn't running; try again later.
      this.retry = setTimeout(() => this.connect(), RETRY_MS);
      return;
    }
    const socket = net.createConnection(next);
    let buffer = Buffer.alloc(0);
    socket.once('connect', () => {
      this.socket = socket;
      socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0);
        const len = buffer.readInt32LE(4);
        if (buffer.length < 8 + len) break;
        let msg = null;
        try {
          msg = JSON.parse(buffer.subarray(8, 8 + len).toString());
        } catch {
          // ignore a malformed frame
        }
        buffer = buffer.subarray(8 + len);
        this.onMessage(op, msg);
      }
    });
    socket.on('error', () => {
      // Not this socket: try the next candidate.
      if (this.socket !== socket) this.connect(rest);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), RETRY_MS);
    });
  }

  onMessage(op, msg) {
    if (op === OP.PING) {
      this.socket?.write(encode(OP.PONG, msg));
    } else if (op === OP.CLOSE) {
      this.log('discord closed the connection', msg);
      this.socket?.destroy();
    } else if (op === OP.FRAME && msg?.evt === 'READY') {
      this.ready = true;
      this.sentAt = 0;
      this.schedule();
    } else if (op === OP.FRAME && msg?.evt === 'ERROR') {
      this.log('discord rejected an update', msg.data);
    }
  }

  schedule() {
    if (!this.ready || this.timer) return;
    const wait = Math.max(0, this.sentAt + MIN_GAP_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.ready) this.send(this.wanted);
    }, wait);
  }

  send(activity) {
    this.sentAt = Date.now();
    this.socket?.write(
      encode(OP.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: randomUUID(),
      }),
    );
  }
}

module.exports = { DiscordPresence };

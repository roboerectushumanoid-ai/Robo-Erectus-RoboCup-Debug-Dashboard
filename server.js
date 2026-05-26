'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const dgram   = require('dgram');
const path    = require('path');

// Config
// Accept team ID as any numeric argument.
const teamIdArg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const TEAM_ID   = teamIdArg ? parseInt(teamIdArg, 10) : 55;
const PORT_GC_DATA    = 3838;          // GameController → robots (broadcast game state)
const PORT_STATUS_FWD = 3738;          // GameController re-broadcasts robot status here
const PORT_TEAM_COMM  = 10000 + TEAM_ID; // robot-to-robot compact packets
const WEB_PORT        = 8080;

const STATE_NAMES     = ['Initial', 'Ready', 'Set', 'Playing', 'Finished'];
const PHASE_NAMES     = ['Normal', 'PenaltyShootOut', 'ExtraTime', 'Timeout'];
const SET_PLAY_NAMES  = ['None', 'DirectFreeKick', 'IndirectFreeKick', 'PenaltyKick', 'ThrowIn', 'GoalKick', 'CornerKick'];

// Shared state
const appState = {
  gameState: null,
  robots: {},    // keyed by playerNum string
};

// Parsers

// RoboCupGameControlData (version 19, from RoboCupGameControlData.h)
// Struct layout (bytes):
//   0-3   header "RGme"
//   4     version
//   5     packetNumber
//   6     playersPerTeam
//   7     competitionType
//   8     stopped
//   9     gamePhase
//   10    state
//   11    setPlay
//   12    firstHalf
//   13    kickingTeam
//   14-15 secsRemaining (int16LE)
//   16-17 secondaryTime (int16LE)
//   18+   TeamInfo[2]  (each = 90 bytes: 10 header bytes + 20×4-byte RobotInfo)
function parseGameControlData(buf) {
  if (buf.length < 18) return null;
  if (buf.toString('ascii', 0, 4) !== 'RGme') return null;

  const version       = buf.readUInt8(4);
  const playersPerTeam = buf.readUInt8(6);
  const gamePhase     = buf.readUInt8(9);
  const state         = buf.readUInt8(10);
  const setPlay       = buf.readUInt8(11);
  const firstHalf     = buf.readUInt8(12) === 1;
  const kickingTeam   = buf.readUInt8(13);
  const secsRemaining = buf.readInt16LE(14);
  const secondaryTime = buf.readInt16LE(16);

  // TeamInfo: teamNumber(1)+fieldCol(1)+gkCol(1)+gk(1)+score(1)+penaltyShot(1)
  //           +singleShots(2)+messageBudget(2)+players[20]×4 = 90 bytes
  const TEAM_INFO_SIZE   = 90;
  const PLAYERS_OFFSET   = 10; // within TeamInfo
  const ROBOT_INFO_SIZE  = 4;  // penalty(1)+secsTill(1)+warnings(1)+cautions(1)
  const TEAMS_BASE       = 18;

  const teams = [0, 1].map(i => {
    const base = TEAMS_BASE + i * TEAM_INFO_SIZE;
    if (buf.length < base + 5) return null;
    const teamNumber    = buf.readUInt8(base);
    const goalkeeper    = buf.readUInt8(base + 3); // GC-designated goalkeeper player number
    const score         = buf.readUInt8(base + 4);
    const messageBudget = buf.length >= base + 10 ? buf.readUInt16LE(base + 8) : 0;
    const players = [];
    for (let p = 0; p < Math.min(playersPerTeam, 20); p++) {
      const pBase = base + PLAYERS_OFFSET + p * ROBOT_INFO_SIZE;
      if (buf.length < pBase + 2) break;
      players.push({
        playerNum:          p + 1,
        penalty:            buf.readUInt8(pBase),
        secsTillUnpenalised: buf.readUInt8(pBase + 1),
      });
    }
    return { teamNumber, goalkeeper, score, messageBudget, players };
  }).filter(Boolean);

  return {
    version, playersPerTeam,
    state:     STATE_NAMES[state]    ?? `Unknown(${state})`,
    gamePhase: PHASE_NAMES[gamePhase] ?? `Unknown(${gamePhase})`,
    setPlay:   SET_PLAY_NAMES[setPlay] ?? `Unknown(${setPlay})`,
    firstHalf, kickingTeam, secsRemaining, secondaryTime, teams,
  };
}

// RoboCupGameControlReturnData (32 bytes, from RoboCupGameControlData.h)
// Forwarded by GameController on port 3738 with a 4-byte IPv4 prefix.
// Struct layout (after the 4-byte IP prefix):
//   0-3   header "RGrt"
//   4     version
//   5     playerNum (1-based)
//   6     teamNum
//   7     fallen (1=fallen, 255=unknown, 0=ok)
//   8-11  pose[0] x  (float32LE, mm, +x toward scoring goal)
//   12-15 pose[1] y  (float32LE, mm, +y CCW from +x)
//   16-19 pose[2] theta (float32LE, radians)
//   20-23 ballAge    (float32LE, seconds since last seen; -1 = never)
//   24-27 ball[0] x  (float32LE, mm, relative to robot frame)
//   28-31 ball[1] y  (float32LE, mm, relative to robot frame)
function parseReturnData(buf) {
  if (buf.length < 32) return null;
  if (buf.toString('ascii', 0, 4) !== 'RGrt') return null;
  const playerNum = buf.readUInt8(5);
  const teamNum   = buf.readUInt8(6);
  const fallen    = buf.readUInt8(7) === 1;
  if (playerNum < 1 || playerNum > 20) return null;
  return {
    playerNum, teamNum, fallen,
    pose: { x: buf.readFloatLE(8), y: buf.readFloatLE(12), theta: buf.readFloatLE(16) },
    ballAge: buf.readFloatLE(20),
    ball:    { x: buf.readFloatLE(24), y: buf.readFloatLE(28) },
  };
}

// CompactTeamPacket (5 bytes, from robot_communication_node.cpp)
// byte[0]  password (0xA7)
// byte[1]  identity:
//   bits 3-0  player_id  (COMPACT_PLAYER_ID_MASK = 0x0F)
//   bits 5-4  role       (0=unknown, 1=striker, 2=goalkeeper, 3=defender)
//   bit  6    is_alive   (COMPACT_READY_MASK = 0x40)
//   bit  7    unused (always 0)
// byte[2]  (ball_zone << 4) | player1_zone   — 0=unknown, 1-9 valid
// byte[3]  (player2_zone << 4) | player3_zone
// byte[4]  format marker (0xA2)
function parseTeamComm(buf) {
  if (buf.length !== 5) return null;
  if (buf[0] !== 0xA7) return null;           // password mismatch
  if (buf[4] !== 0xA2) return null;           // format marker mismatch

  const identity = buf[1];
  const senderId = identity & 0x0F;
  const role     = (identity & 0x30) >> 4;   // 0=unknown,1=striker,2=goalkeeper,3=defender
  const isAlive  = (identity & 0x40) !== 0;
  if (senderId < 1 || senderId > 5) return null;

  const ballZone = (buf[2] >> 4) & 0x0F;     // sender's observed ball zone (0=unknown, 1-9)
  const players  = [
    { playerNum: 1, zone: buf[2] & 0x0F },
    { playerNum: 2, zone: (buf[3] >> 4) & 0x0F },
    { playerNum: 3, zone: buf[3] & 0x0F },
  ];

  return { senderId, role, isAlive, players, ballZone };
}

// Express + Socket.io
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', socket => {
  socket.emit('state', { ...appState, teamId: TEAM_ID });
});

function broadcast() {
  io.emit('state', { ...appState, teamId: TEAM_ID });
}

// UDP helpers
function makeUdp(port, label, onMsg) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', err => console.error(`[${label}] ${err.message}`));
  sock.on('message', onMsg);
  sock.bind(port, '0.0.0.0', () => console.log(`[${label}] listening on :${port}`));
  return sock;
}

// Listener 1: GameController game state (broadcast from GC on port 3838)
makeUdp(PORT_GC_DATA, 'GC-Data', msg => {
  const parsed = parseGameControlData(msg);
  if (parsed) { appState.gameState = parsed; broadcast(); }
});

// Listener 2: Forwarded robot status (GC re-broadcasts on port 3738)
// Some GC versions prepend a 4-byte IPv4 sender address; others send the raw
// 32-byte ReturnData directly.  Try both so either format works.
makeUdp(PORT_STATUS_FWD, 'Status-Fwd', (msg, rinfo) => {
  let senderIp, parsed;

  // Try with 4-byte IP prefix first (36-byte total)
  if (msg.length >= 36) {
    const slice = msg.slice(4);
    if (slice.toString('ascii', 0, 4) === 'RGrt') {
      senderIp = `${msg[0]}.${msg[1]}.${msg[2]}.${msg[3]}`;
      parsed   = parseReturnData(slice);
    }
  }

  // Fall back: raw 32-byte packet without IP prefix — use UDP source address
  if (!parsed && msg.length >= 32) {
    senderIp = rinfo.address;
    parsed   = parseReturnData(msg);
  }

  if (!parsed) return;
  const key = String(parsed.playerNum);
  appState.robots[key] = { ...appState.robots[key], ...parsed, senderIp, lastSeen: Date.now() };
  broadcast();
});

// Listener 3: Robot-to-robot team comms (broadcast on port 10000+teamId)
makeUdp(PORT_TEAM_COMM, 'Team-Comm', msg => {
  const parsed = parseTeamComm(msg);
  if (!parsed) return;

  // Update zone for each player embedded in the packet (players 1-3)
  parsed.players.forEach(p => {
    const key = String(p.playerNum);
    appState.robots[key] = {
      ...appState.robots[key],
      playerNum: p.playerNum,
      zone: p.zone,
    };
  });

  // Sender-specific fields (role, alive, ball zone)
  const sKey = String(parsed.senderId);
  appState.robots[sKey] = {
    ...appState.robots[sKey],
    playerNum: parsed.senderId,
    role:      parsed.role,
    isAlive:   parsed.isAlive,
    isLead:    false,              // not encoded in 5-byte packet
    ballZone:  parsed.ballZone,
    lastSeen:  Date.now(),
  };

  broadcast();
});

// Stale robot cleanup (mark robots silent for >5 s)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  Object.values(appState.robots).forEach(r => {
    const stale = r.lastSeen && now - r.lastSeen > 5000;
    if (r.stale !== stale) { r.stale = stale; changed = true; }
  });
  if (changed) broadcast();
}, 1000);


// Start
server.listen(WEB_PORT, () => {
  console.log(`\nRoboCup Dashboard → http://localhost:${WEB_PORT}`);
  console.log(`Team ${TEAM_ID} | GC=:${PORT_GC_DATA} | StatusFwd=:${PORT_STATUS_FWD} | TeamComm=:${PORT_TEAM_COMM}`);
  console.log('\nOverride team ID: node server.js <team_id>\n');
});

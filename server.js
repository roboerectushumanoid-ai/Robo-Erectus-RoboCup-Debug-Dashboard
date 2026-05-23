'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const dgram   = require('dgram');
const path    = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
// Accept team ID as any numeric argument so --demo order doesn't matter
const teamIdArg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const TEAM_ID   = teamIdArg ? parseInt(teamIdArg, 10) : 55;
const PORT_GC_DATA    = 3838;          // GameController → robots (broadcast game state)
const PORT_STATUS_FWD = 3738;          // GameController re-broadcasts robot status here
const PORT_TEAM_COMM  = 10000 + TEAM_ID; // robot-to-robot compact packets
const WEB_PORT        = 8080;

const STATE_NAMES     = ['Initial', 'Ready', 'Set', 'Playing', 'Finished'];
const PHASE_NAMES     = ['Normal', 'PenaltyShootOut', 'ExtraTime', 'Timeout'];
const SET_PLAY_NAMES  = ['None', 'DirectFreeKick', 'IndirectFreeKick', 'PenaltyKick', 'ThrowIn', 'GoalKick', 'CornerKick'];

// ── Shared state ──────────────────────────────────────────────────────────────
const appState = {
  gameState: null,
  robots: {},    // keyed by playerNum string
};

// ── Parsers ───────────────────────────────────────────────────────────────────

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
    return { teamNumber, score, messageBudget, players };
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

// CompactTeamPacket (14 bytes, from robot_communication_node.cpp)
// byte[1] bit layout (constants from robot_communication_node.cpp):
//   bits 3-0  player_id  (COMPACT_PLAYER_ID_MASK = 0x0F)
//   bits 5-4  role       (COMPACT_ROLE_MASK = 0x30, COMPACT_ROLE_SHIFT = 4)
//   bit  6    is_alive   (COMPACT_READY_MASK = 0x40)
//   bit  7    is_lead    (COMPACT_ACTIVE_BALL_ACTION_MASK = 0x80)
// Confidence nibbles are 0-15 → multiply by (100/15) for percent.
function parseTeamComm(buf) {
  if (buf.length < 14) return null;
  const identity = buf[1];
  const senderId = identity & 0x0F;
  const role     = (identity & 0x30) >> 4;
  const isAlive  = (identity & 0x40) !== 0;
  const isLead   = (identity & 0x80) !== 0;
  if (senderId < 1 || senderId > 5) return null;

  const hiNibble = b => (b >> 4) & 0x0F;
  const loNibble = b => b & 0x0F;
  const confPct  = n => Math.round(n * 100 / 15);

  const players = [
    { playerNum: 1, zone: hiNibble(buf[2]), ballZone: loNibble(buf[3]), confidence: confPct(hiNibble(buf[5])), chaseScore: buf[7],  goalieScore: buf[10] },
    { playerNum: 2, zone: loNibble(buf[2]), ballZone: hiNibble(buf[4]), confidence: confPct(loNibble(buf[5])), chaseScore: buf[8],  goalieScore: buf[11] },
    { playerNum: 3, zone: hiNibble(buf[3]), ballZone: loNibble(buf[4]), confidence: confPct(hiNibble(buf[6])), chaseScore: buf[9],  goalieScore: buf[12] },
  ];

  return { senderId, role, isAlive, isLead, players, finalBallZone: loNibble(buf[6]) };
}

// ── Express + Socket.io ───────────────────────────────────────────────────────
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

// ── UDP helpers ───────────────────────────────────────────────────────────────
function makeUdp(port, label, onMsg) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', err => console.error(`[${label}] ${err.message}`));
  sock.on('message', onMsg);
  sock.bind(port, '0.0.0.0', () => console.log(`[${label}] listening on :${port}`));
  return sock;
}

// ── Listener 1: GameController game state (broadcast from GC on port 3838) ───
makeUdp(PORT_GC_DATA, 'GC-Data', msg => {
  const parsed = parseGameControlData(msg);
  if (parsed) { appState.gameState = parsed; broadcast(); }
});

// ── Listener 2: Forwarded robot status (GC re-broadcasts on port 3738) ───────
// Each message is a 4-byte IPv4 sender address followed by 32-byte ReturnData.
makeUdp(PORT_STATUS_FWD, 'Status-Fwd', msg => {
  if (msg.length < 36) return;
  const senderIp = `${msg[0]}.${msg[1]}.${msg[2]}.${msg[3]}`;
  const parsed   = parseReturnData(msg.slice(4));
  if (!parsed) return;
  const key = String(parsed.playerNum);
  appState.robots[key] = { ...appState.robots[key], ...parsed, senderIp, lastSeen: Date.now() };
  broadcast();
});

// ── Listener 3: Robot-to-robot team comms (broadcast on port 10000+teamId) ───
makeUdp(PORT_TEAM_COMM, 'Team-Comm', msg => {
  const parsed = parseTeamComm(msg);
  if (!parsed) return;
  parsed.players.forEach(p => {
    const key = String(p.playerNum);
    appState.robots[key] = {
      ...appState.robots[key],
      playerNum: p.playerNum,
      zone: p.zone, ballZone: p.ballZone,
      confidence: p.confidence,
      chaseScore: p.chaseScore, goalieScore: p.goalieScore,
      lastSeen: Date.now(),
    };
    if (p.playerNum === parsed.senderId) {
      appState.robots[key].role    = parsed.role;
      appState.robots[key].isAlive = parsed.isAlive;
      appState.robots[key].isLead  = parsed.isLead;
    }
  });
  broadcast();
});

// ── Stale robot cleanup (mark robots silent for >5 s) ────────────────────────
setInterval(() => {
  const now = Date.now();
  let changed = false;
  Object.values(appState.robots).forEach(r => {
    const stale = r.lastSeen && now - r.lastSeen > 5000;
    if (r.stale !== stale) { r.stale = stale; changed = true; }
  });
  if (changed) broadcast();
}, 1000);

// ── Demo mode ─────────────────────────────────────────────────────────────────
// Run with:  node server.js --demo
// Generates moving robots, a live countdown, and penalty/score data so you can
// test the dashboard without real hardware.
if (process.argv.includes('--demo')) {
  console.log('[Demo] Injecting fake robot data every 500 ms');

  const HALF_W = 4400, HALF_H = 2900;  // keep robots inside field boundary

  // Starting positions and velocities for 3 robots
  const demoRobots = [
    { playerNum: 1, teamNum: TEAM_ID, role: 0, isAlive: true,  isLead: true,
      pose: { x: -1500, y:  600, theta:  0.4 }, vel: { x:  60, y:  30, t: 0.04 },
      ballAge: 0.2, ball: { x: 350, y: 80 }, fallen: false },
    { playerNum: 2, teamNum: TEAM_ID, role: 1, isAlive: true,  isLead: false,
      pose: { x: -3800, y:    0, theta:  0.0 }, vel: { x:  10, y:  20, t: 0.02 },
      ballAge: -1,  ball: { x: 0,   y: 0  }, fallen: false },
    { playerNum: 3, teamNum: TEAM_ID, role: 2, isAlive: true,  isLead: false,
      pose: { x:  1200, y: -700, theta:  2.6 }, vel: { x: -50, y:  40, t: -0.03 },
      ballAge: 1.8, ball: { x: -400, y: 150 }, fallen: false },
  ];

  appState.gameState = {
    version: 19,
    state: 'Playing', gamePhase: 'Normal', setPlay: 'None',
    firstHalf: true, kickingTeam: TEAM_ID,
    secsRemaining: 420, secondaryTime: 0,
    teams: [
      { teamNumber: TEAM_ID, score: 2, messageBudget: 1180,
        players: [
          { playerNum: 1, penalty: 0, secsTillUnpenalised: 0 },
          { playerNum: 2, penalty: 0, secsTillUnpenalised: 0 },
          { playerNum: 3, penalty: 0, secsTillUnpenalised: 0 },
        ] },
      { teamNumber: 42, score: 1, messageBudget: 950,
        players: [
          { playerNum: 1, penalty: 0,  secsTillUnpenalised: 0  },
          { playerNum: 2, penalty: 9,  secsTillUnpenalised: 18 }, // Pushing
          { playerNum: 3, penalty: 0,  secsTillUnpenalised: 0  },
        ] },
    ],
  };

  // Decision sequences per role — matches the real brain_tree.cpp states
  const DECISIONS = {
    striker:    ['find', 'chase', 'chase', 'adjust', 'kick', 'find'],
    goalkeeper: ['zone_find', 'retreat', 'chase', 'adjust', 'kick', 'zone_find'],
    defender:   ['hold', 'chase', 'adjust', 'kick', 'hold'],
  };
  const ROLE_KEYS = ['striker', 'goalkeeper', 'defender'];

  let tick = 0;
  setInterval(() => {
    tick++;

    // Count down match clock
    if (appState.gameState.secsRemaining > 0) appState.gameState.secsRemaining--;

    // Move robots (bounce off field boundary)
    demoRobots.forEach((r, i) => {
      r.pose.x += r.vel.x + (Math.random() - 0.5) * 20;
      r.pose.y += r.vel.y + (Math.random() - 0.5) * 20;
      r.pose.theta += r.vel.t + (Math.random() - 0.5) * 0.05;

      if (Math.abs(r.pose.x) > HALF_W) r.vel.x *= -1;
      if (Math.abs(r.pose.y) > HALF_H) r.vel.y *= -1;
      r.pose.x = Math.max(-HALF_W, Math.min(HALF_W, r.pose.x));
      r.pose.y = Math.max(-HALF_H, Math.min(HALF_H, r.pose.y));

      // Confidence oscillates differently per robot
      const conf = Math.round(55 + 40 * Math.sin(tick * 0.08 + i * 2.1));

      // Ball age ticks up; robot 1 keeps seeing the ball, others lose it
      if (r.ballAge >= 0) r.ballAge += 0.5;
      if (r.ballAge > (i === 0 ? 3 : 6)) r.ballAge = i === 0 ? 0 : -1;

      // Occasionally make robot 3 fallen
      const fallen = (i === 2) && (Math.floor(tick / 20) % 2 === 1);

      // Cycle through realistic behavior decisions (changes every ~3 s at 0.5 s interval)
      const roleKey  = ROLE_KEYS[i] ?? 'striker';
      const decList  = DECISIONS[roleKey];
      const decIndex = Math.floor(tick / 6) % decList.length;
      const decision = `${roleKey}-${decList[decIndex]}`;

      appState.robots[String(r.playerNum)] = {
        ...r, fallen,
        confidence:   conf,
        decision,
        decisionTime: Date.now(),
        zone:        Math.ceil(((r.pose.x + HALF_W) / (HALF_W * 2)) * 3 + ((r.pose.y + HALF_H) / (HALF_H * 2)) * 3 * 3) || 1,
        ballZone:    Math.floor(Math.random() * 9) + 1,
        chaseScore:  Math.round(80 + 50 * Math.sin(tick * 0.1 + i)),
        goalieScore: Math.round(120 + 80 * Math.cos(tick * 0.07 + i)),
        senderIp:    `192.168.0.${10 + i}`,
        lastSeen:    Date.now(),
        stale:       false,
      };
    });

    broadcast();
  }, 500);
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(WEB_PORT, () => {
  console.log(`\nRoboCup Dashboard → http://localhost:${WEB_PORT}`);
  console.log(`Team ${TEAM_ID} | GC=:${PORT_GC_DATA} | StatusFwd=:${PORT_STATUS_FWD} | TeamComm=:${PORT_TEAM_COMM}`);
  if (process.argv.includes('--demo')) console.log('[Demo mode active — no real robots needed]');
  console.log('\nOverride team ID:  node server.js <team_id>');
  console.log('Demo mode:         node server.js --demo\n');
});

'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const dgram   = require('dgram');
const path    = require('path');
const fs      = require('fs');
const { spawn, spawnSync } = require('child_process');

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

const EXAMPLE_DIR = path.join(__dirname, 'examples', 'team_comm_sim');
const EXAMPLES = [
  {
    id: 'simulate_game',
    label: 'Moving game simulation',
    file: 'simulate_game.py',
    description: 'Broadcasts moving zones, changing scores, roles, and lead state for 60 seconds.',
    args: teamId => ['--team-id', String(teamId), '--address', '127.0.0.1', '--duration', '60'],
  },
  {
    id: 'role_switch_ack',
    label: 'Role-switch ACK scenario',
    file: 'send_role_switch_ack.py',
    description: 'Runs the goalie role-switch request and ACK handshake example.',
    args: teamId => ['--team-id', String(teamId), '--address', '127.0.0.1', '--players', '1,2,3'],
  },
];
let runningExample = null;
const exampleLog = [];

function pathLooksLikePythonInstaller(command) {
  return /^python-\d+\.\d+.*(?:amd64|win32|arm64)\.exe$/i.test(path.basename(command));
}

function pythonVersion(command, args = []) {
  const result = spawnSync(command, [...args, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return result.error ? null : (/^Python\s+\d+/i.test(output) ? output : null);
}

function resolvePythonCommand() {
  const warnings = [];
  const envPython = process.env.PYTHON || process.env.python;
  const candidates = [];

  if (envPython) {
    if (path.isAbsolute(envPython) || envPython.includes(path.sep)) {
      if (!fs.existsSync(envPython)) {
        warnings.push(`Ignoring PYTHON=${envPython}: file does not exist`);
      } else if (pathLooksLikePythonInstaller(envPython)) {
        warnings.push(`Ignoring PYTHON=${envPython}: this looks like a Python installer, not python.exe`);
      } else {
        candidates.push({ command: envPython, args: [] });
      }
    } else {
      candidates.push({ command: envPython, args: [] });
    }
  }

  candidates.push(
    { command: process.platform === 'win32' ? 'python' : 'python3', args: [] },
    { command: 'python3', args: [] },
  );
  if (process.platform === 'win32') candidates.push({ command: 'py', args: ['-3'] });

  for (const candidate of candidates) {
    const version = pythonVersion(candidate.command, candidate.args);
    if (version) return { ...candidate, version, warnings };
  }

  return { command: null, args: [], version: null, warnings };
}

function appendExampleLog(line) {
  const text = String(line).trimEnd();
  if (!text) return;
  exampleLog.push(...text.split(/\r?\n/).map(entry => `[${new Date().toLocaleTimeString()}] ${entry}`));
  while (exampleLog.length > 80) exampleLog.shift();
}

function publicExample(example) {
  return {
    id: example.id,
    label: example.label,
    description: example.description,
    running: runningExample?.id === example.id,
  };
}

function exampleStatus() {
  return {
    running: runningExample ? {
      id: runningExample.id,
      label: runningExample.label,
      pid: runningExample.process.pid,
      startedAt: runningExample.startedAt,
    } : null,
    log: exampleLog,
  };
}

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

// CompactTeamPacket (14 bytes, from robot_communication_node.cpp)
// byte[0]  password (0xA7)
// byte[1]  identity: lead(7), alive(6), role(5-4), sender player id(3-0)
// byte[2]  player1 zone(7-4), player2 zone(3-0)
// byte[3]  player3 zone(7-4), player1 ball zone(3-0)
// byte[4]  player2 ball zone(7-4), player3 ball zone(3-0)
// byte[5]  player1 confidence(7-4), player2 confidence(3-0)
// byte[6]  player3 confidence(7-4), final ball zone(3-0)
// byte[7-9]   player1-3 chase scores
// byte[10-12] player1-3 goalie scores
// byte[13] role-switch control: opcode(7-6), seq(5-4), target(3-2), role(1-0)
function parseTeamComm(buf) {
  if (buf.length !== 14) return null;
  if (buf[0] !== 0xA7) return null;

  const identity = buf[1];
  const senderId = identity & 0x0F;
  const role     = (identity & 0x30) >> 4;   // 0=unknown,1=striker,2=goalkeeper,3=defender
  const isAlive  = (identity & 0x40) !== 0;
  const isLead   = (identity & 0x80) !== 0;
  if (senderId < 1 || senderId > 3) return null;
  if (role < 0 || role > 3) return null;

  const zones = [
    (buf[2] >> 4) & 0x0F,
    buf[2] & 0x0F,
    (buf[3] >> 4) & 0x0F,
  ];
  const ballZones = [
    buf[3] & 0x0F,
    (buf[4] >> 4) & 0x0F,
    buf[4] & 0x0F,
  ];
  const confidences = [
    (buf[5] >> 4) & 0x0F,
    buf[5] & 0x0F,
    (buf[6] >> 4) & 0x0F,
  ];
  const finalBallZone = buf[6] & 0x0F;

  if (![...zones, ...ballZones, finalBallZone].every(zone => zone >= 0 && zone <= 9)) return null;

  const roleSwitch = {
    opcode: (buf[13] & 0xC0) >> 6,
    seq:    (buf[13] & 0x30) >> 4,
    target: (buf[13] & 0x0C) >> 2,
    role:   buf[13] & 0x03,
  };

  const roleSwitchValid = roleSwitch.opcode === 0
    ? roleSwitch.seq === 0 && roleSwitch.target === 0 && roleSwitch.role === 0
    : roleSwitch.target >= 1 && roleSwitch.target <= 3 && roleSwitch.role === 2;
  if (!roleSwitchValid) return null;

  const players = [1, 2, 3].map((playerNum, i) => ({
    playerNum,
    zone:        zones[i],
    ballZone:    ballZones[i],
    confidence:  confidences[i] * 100 / 15,
    chaseScore:  buf[7 + i] * 100 / 255,
    goalieScore: buf[10 + i] * 100 / 255,
  }));

  return {
    senderId,
    role,
    isAlive,
    isLead,
    finalBallZone,
    roleSwitch,
    players,
  };
}

// Express + Socket.io
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/examples', (req, res) => {
  res.json({ examples: EXAMPLES.map(publicExample), ...exampleStatus() });
});

app.post('/api/examples/run', (req, res) => {
  const example = EXAMPLES.find(item => item.id === req.body?.id);
  if (!example) {
    res.status(404).json({ error: 'Unknown example script' });
    return;
  }

  if (runningExample) {
    res.status(409).json({ error: `${runningExample.label} is already running`, ...exampleStatus() });
    return;
  }

  const scriptPath = path.join(EXAMPLE_DIR, example.file);
  if (!scriptPath.startsWith(EXAMPLE_DIR) || !fs.existsSync(scriptPath)) {
    res.status(500).json({ error: 'Example script is missing' });
    return;
  }

  const python = resolvePythonCommand();
  python.warnings.forEach(appendExampleLog);
  if (!python.command) {
    appendExampleLog('Could not find a usable Python interpreter. Install Python or set PYTHON to python.exe.');
    res.status(500).json({ error: 'Could not find a usable Python interpreter', ...exampleStatus() });
    return;
  }

  const args = [...python.args, scriptPath, ...example.args(TEAM_ID)];
  const child = spawn(python.command, args, {
    cwd: EXAMPLE_DIR,
    windowsHide: true,
  });
  runningExample = {
    id: example.id,
    label: example.label,
    process: child,
    startedAt: Date.now(),
  };
  appendExampleLog(`Using ${python.version}`);
  appendExampleLog(`Started ${example.label}: ${python.command} ${args.map(arg => path.basename(arg) === arg ? arg : path.basename(arg)).join(' ')}`);

  child.stdout.on('data', chunk => appendExampleLog(chunk.toString()));
  child.stderr.on('data', chunk => appendExampleLog(chunk.toString()));
  child.on('error', err => {
    appendExampleLog(`Failed to start ${example.label}: ${err.message}`);
    if (runningExample?.process === child) runningExample = null;
  });
  child.on('close', code => {
    appendExampleLog(`${example.label} exited with code ${code}`);
    if (runningExample?.process === child) runningExample = null;
  });

  res.json(exampleStatus());
});

app.post('/api/examples/stop', (req, res) => {
  if (!runningExample) {
    res.json(exampleStatus());
    return;
  }

  appendExampleLog(`Stopping ${runningExample.label}`);
  runningExample.process.kill();
  res.json(exampleStatus());
});

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
makeUdp(PORT_TEAM_COMM, 'Team-Comm', (msg, rinfo) => {
  const parsed = parseTeamComm(msg);
  if (!parsed) return;
  const now = Date.now();

  // Update cached player fields embedded in the packet (players 1-3).
  parsed.players.forEach(p => {
    const key = String(p.playerNum);
    appState.robots[key] = {
      ...appState.robots[key],
      playerNum: p.playerNum,
      zone:        p.zone,
      ballZone:    p.ballZone,
      confidence:  p.confidence,
      chaseScore:  p.chaseScore,
      goalieScore: p.goalieScore,
      lastSeen:    now,
    };
  });

  // Sender-specific fields.
  const sKey = String(parsed.senderId);
  appState.robots[sKey] = {
    ...appState.robots[sKey],
    playerNum:     parsed.senderId,
    role:          parsed.role,
    isAlive:       parsed.isAlive,
    isLead:        parsed.isLead,
    finalBallZone: parsed.finalBallZone,
    roleSwitch:    parsed.roleSwitch,
    roleSwitchTime: parsed.roleSwitch.opcode === 0 ? null : now,
    senderIp:      rinfo.address,
    lastSeen:      now,
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

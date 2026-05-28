import { ROLE_NAMES } from './constants.js';

const ROLE_SWITCH_TTL_MS = 8000;
const OP_REQUEST = 1;
const OP_ACK = 2;
const OPCODE_META = {
  [OP_REQUEST]: { cls: 'request' },
  [OP_ACK]: { cls: 'ack' },
};

function roleLabel(role) {
  return ROLE_NAMES[role] ?? `Role ${role}`;
}

function liveRoleSwitch(robot, now) {
  const roleSwitch = robot?.roleSwitch;
  if (!roleSwitch || !OPCODE_META[roleSwitch.opcode]) return null;
  if (!robot.roleSwitchTime || now - robot.roleSwitchTime > ROLE_SWITCH_TTL_MS) return null;
  if (roleSwitch.target < 1 || roleSwitch.target > 3) return null;
  return roleSwitch;
}

function matchingRequester(robot, robots, roleSwitch, now) {
  return Object.values(robots ?? {}).find(peer => {
    const peerSwitch = liveRoleSwitch(peer, now);
    return peer?.playerNum !== robot?.playerNum
      && peerSwitch?.opcode === OP_REQUEST
      && peerSwitch.seq === roleSwitch.seq
      && peerSwitch.role === roleSwitch.role
      && peerSwitch.target === robot?.playerNum;
  });
}

export function roleSwitchView(robot, robotsOrNow = null, now = Date.now()) {
  const robots = typeof robotsOrNow === 'number' ? null : robotsOrNow;
  const currentTime = typeof robotsOrNow === 'number' ? robotsOrNow : now;
  const roleSwitch = liveRoleSwitch(robot, currentTime);
  if (!roleSwitch) return null;

  const meta = OPCODE_META[roleSwitch.opcode];
  const role = roleLabel(roleSwitch.role);
  let text;

  if (roleSwitch.opcode === OP_REQUEST) {
    text = `Asked P${roleSwitch.target} to become ${role}`;
  } else {
    const requester = matchingRequester(robot, robots, roleSwitch, currentTime);
    text = requester
      ? `Accepted request from P${requester.playerNum}; now ${role}`
      : `Accepted ${role} request`;
  }

  return {
    cls: meta.cls,
    text,
    seq: `seq ${roleSwitch.seq}`,
  };
}

import { ROLE_NAMES } from './constants.js';

const ROLE_SWITCH_TTL_MS = 8000;
const OPCODE_META = {
  1: { cls: 'request', verb: 'Wants' },
  2: { cls: 'ack', verb: 'Accepted' },
};

export function roleSwitchView(robot, now = Date.now()) {
  const roleSwitch = robot?.roleSwitch;
  if (!roleSwitch || !OPCODE_META[roleSwitch.opcode]) return null;
  if (!robot.roleSwitchTime || now - robot.roleSwitchTime > ROLE_SWITCH_TTL_MS) return null;
  if (roleSwitch.target < 1 || roleSwitch.target > 3) return null;

  const meta = OPCODE_META[roleSwitch.opcode];
  const role = ROLE_NAMES[roleSwitch.role] ?? `Role ${roleSwitch.role}`;

  return {
    cls: meta.cls,
    text: `${meta.verb} ${role} with P${roleSwitch.target}`,
    seq: `seq ${roleSwitch.seq}`,
  };
}

export const FIELD_W_MM = 14000;
export const FIELD_H_MM = 9000;

export const ROBOT_COLORS = ['#58a6ff', '#3fb950', '#f0883e', '#a371f7', '#ffa657'];

// Path-tracking trail sampling: skip points closer than this (avoids flooding
// the array while a robot is stationary), cap length as a safety valve.
export const TRAIL_MIN_DIST_MM = 40;
export const TRAIL_MAX_POINTS = 4000;

// Matches CompactRole enum: 0=unknown, 1=striker, 2=goalkeeper, 3=defender.
export const ROLE_NAMES = ['Unknown', 'Striker', 'Goalkeeper', 'Defender'];

export const PENALTY_NAMES = {
  0: 'None',
  1: 'Ball Manipulation',
  2: 'Physical Contact',
  3: 'Illegal Attack',
  4: 'Illegal Defense',
  5: 'Pickup/Incapable',
  6: 'Service',
  11: 'Substitute',
  14: 'Substitute',
  15: 'Manual',
};

// Edit these to match your robots.
export const DEFAULT_ROBOTS = [
  { playerNum: 1, ip: '192.168.0.167' },
  { playerNum: 2, ip: '192.168.0.169' },
];

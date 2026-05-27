# RoboCup Debug Dashboard

A lightweight, locally-hosted debug dashboard for RoboCup HSL matches.
It **only listens** — it never sends anything to the robots.

> **This is a troubleshooting tool only. Do not use it during any official match.**

## Folder structure

```
robocup-gui/
├── server.js            ← Node.js backend: UDP listeners + WebSocket server
├── package.json
├── public/
│   ├── index.html       ← Frontend: runs in your browser (served by server.js)
│   ├── index.css
│   └── js/
│       ├── main.js      ← Entry point, wires all modules together
│       ├── field.js     ← Canvas field renderer (robot positions, ball, arrows)
│       ├── robots.js    ← Robot card panels
│       ├── scoreCharts.js ← Chase/goalie score history graphs
│       ├── ros.js       ← ROS Bridge integration
│       ├── roleSwitch.js
│       ├── socket.js
│       ├── constants.js
│       └── utils.js
└── examples/
    └── team_comm_sim/   ← Python scripts to simulate robot UDP traffic
        ├── simulate_game.py
        ├── send_role_switch_ack.py
        └── team_comm_packet.py
```

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- Your laptop connected to the **same network** as the robots and GameController

## Install & run

```bash
cd robocup-gui
npm install
npm start
```

Then open **http://localhost:8080** in your browser.

If your team ID is not 55:

```bash
node server.js <team_id>
```

## What it displays

| Panel         | Data                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| Score bar     | Both team scores, live from GameController                                       |
| Info bar      | Game state, phase, half, time remaining, set play, kicking team                  |
| Field canvas  | Robot positions + heading arrows, ball position (orange)                         |
| Robot cards   | Pose (m, °), localisation confidence, zone, ball info, role, chase/goalie score |
| Penalties     | Any penalised player with reason and countdown                                   |
| Score history | Per-robot chase and goalie score graphs over the last 60 s or 5 min              |

Robots that stop sending data for more than 5 seconds are dimmed as **stale**.

## ROS Bridge integration

The dashboard can connect to `rosbridge_server` on each robot and subscribe to
the `/booster_soccer/player_decision` topic to display live robot behaviour.

### Robot-side setup

First, install the ROS 2 bridge package on each robot:

```bash
sudo apt install ros-$ROS_DISTRO-rosbridge-server
```

Then launch it:

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

**Auto-launch:** To start rosbridge automatically with the robot software, run:

```bash
./scripts/start_gui.sh
```

### Dashboard-side

Click **⚙ ROS Bridge** in the dashboard header, add the robot's IP, and click **Connect**.

## UDP ports (receive only)

| Port                | Source                      | Content                                               |
| ------------------- | --------------------------- | ----------------------------------------------------- |
| `3838`            | GameController broadcast    | Game state (score, phase, time, penalties)            |
| `3738`            | GameController re-broadcast | Robot status: exact pose (x, y, θ) and ball position |
| `10000 + team_id` | Robot-to-robot team comms   | Confidence, zone, role, chase/goalie scores           |

## Testing without real robots

The `examples/team_comm_sim/` directory contains Python scripts that broadcast
the same UDP packets the robots would send:

```bash
cd examples/team_comm_sim

# Simulate a live game (players 1-3 with changing zones, roles, scores)
python3 simulate_game.py --team-id 55

# Send a single role-switch ACK packet
python3 send_role_switch_ack.py --team-id 55 --players 1,2,3
```

Use `--address 127.0.0.1` if the simulator and dashboard are on the same machine
and broadcast is blocked by your firewall.

See `examples/team_comm_sim/README.md` for the full option reference.

## Competition legality

This tool is a **passive monitor** — it never sends data to the robots.

- Port `3838` and `10000+teamId` are standard network broadcasts that any device
  on the network receives.
- Port `3738` is a monitoring feed the GameController already provides for
  exactly this purpose (the `StatusMessageForwarder` in the official GC).
- The HSL rule against "manual interaction via communications mechanism" targets
  sending commands to robots, not passive monitoring.

## Troubleshooting

**No robot data appearing**

- Make sure your laptop is on the same subnet as the robots (e.g. `192.168.0.x`).
- Check Windows Firewall is not blocking UDP on ports 3838, 3738, and 10055.

**Positions look wrong**

- Verify `team_id` matches `team_id` in `robocup_demo/src/brain/config/config.yaml` (default: 55).

**Port already in use**

- Another process is using port 8080. Change `WEB_PORT` at the top of `server.js`.

**ROS Bridge shows connection refused**

- `rosbridge_server` is not running on that robot. SSH in and launch it (see above).

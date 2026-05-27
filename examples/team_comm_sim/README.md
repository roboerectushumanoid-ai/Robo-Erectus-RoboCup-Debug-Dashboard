# Team Communication Simulator

These scripts broadcast the same fixed 14-byte UDP teammate packet that the dashboard listens for on:

```text
10000 + team_id
```

For the default team ID `55`, the port is `10055`.

## Run The Dashboard

From the project root:

```bash
node server.js 55
```

Open:

```text
http://localhost:8080
```

## Simulate A Moving Game

From this folder:

```bash
python3 simulate_game.py --team-id 55
```

This sends packets for players 1, 2, and 3, with changing zones, ball zones,
confidence, chase scores, goalie scores, roles, lead state, and a player 2
goalie ACK after 8 seconds.

Useful options:

```bash
python3 simulate_game.py --team-id 55 --duration 0
python3 simulate_game.py --team-id 55 --quiet
python3 simulate_game.py --team-id 55 --dry-run
python3 simulate_game.py --team-id 55 --address 127.0.0.1
```

Use `--address 127.0.0.1` when the simulator and dashboard are on the same
machine and broadcast is blocked by your network/firewall.

## Send The Role-Switch ACK Example

This mirrors the player 2 defender-to-goalie ACK scenario:

```bash
python3 send_role_switch_ack.py --team-id 55 --players 1,2,3
```

Dry run:

```bash
python3 send_role_switch_ack.py --team-id 55 --players 1,2,3 --dry-run
```

## Packet Helpers

`team_comm_packet.py` contains reusable helpers for:

- `pack_team_comm(...)`
- `identity(...)`
- `role_switch(...)`
- score and confidence compact encoding
- broadcast socket setup

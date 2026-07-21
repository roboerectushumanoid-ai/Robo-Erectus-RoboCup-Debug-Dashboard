import argparse
import math
import time

from team_comm_packet import (
    OP_ACK,
    OP_NONE,
    ROLE_DEFENDER,
    ROLE_GOALIE,
    ROLE_STRIKER,
    hex_packet,
    make_broadcast_socket,
    pack_team_comm,
    role_switch,
)


ZONE_PATHS = {
    1: [1, 2, 5, 8, 9, 8, 5, 2],
    2: [3, 2, 5, 4, 1, 2, 5, 6],
    3: [7, 8, 9, 6, 3, 6, 9, 8],
}
BALL_PATH = [5, 8, 9, 8, 5, 2, 1, 4]


def zone_xy(zone):
    if zone <= 0:
        return None
    idx = zone - 1
    return (idx // 3, idx % 3)


def zone_distance(a, b):
    pa = zone_xy(a)
    pb = zone_xy(b)
    if pa is None or pb is None:
        return 4
    return abs(pa[0] - pb[0]) + abs(pa[1] - pb[1])


def game_state(tick, role_switch_at):
    step = tick // 3
    ball_zone = BALL_PATH[step % len(BALL_PATH)]
    zones = [ZONE_PATHS[player][step % len(ZONE_PATHS[player])] for player in (1, 2, 3)]
    ball_zones = [ball_zone if zone_distance(zone, ball_zone) <= 1 else 0 for zone in zones]
    confidences = [max(0, 100 - zone_distance(zone, ball_zone) * 35) for zone in zones]

    chase_scores = [
        min(100, zone_distance(zone, ball_zone) * 28 + player * 3)
        for player, zone in enumerate(zones, start=1)
    ]

    p2_is_goalie = role_switch_at is not None and tick >= role_switch_at
    roles = [
        ROLE_STRIKER,
        ROLE_GOALIE if p2_is_goalie else ROLE_DEFENDER,
        ROLE_DEFENDER if p2_is_goalie else ROLE_GOALIE,
    ]
    goalie_scores = [
        70 + 10 * math.sin(tick * 0.2),
        18 if p2_is_goalie else 55,
        55 if p2_is_goalie else 18,
    ]

    best_chaser_index = min(range(3), key=lambda i: chase_scores[i])
    return roles, zones, ball_zones, confidences, chase_scores, goalie_scores, ball_zone, best_chaser_index


def main():
    parser = argparse.ArgumentParser(description="Continuously broadcast fake 16-byte teammate packets.")
    parser.add_argument("--team-id", type=int, default=55)
    parser.add_argument("--address", default="255.255.255.255")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--hz", type=float, default=4.0)
    parser.add_argument("--duration", type=float, default=60.0, help="Seconds to run. Use 0 to run until Ctrl+C.")
    parser.add_argument("--role-switch-at", type=float, default=8.0, help="Seconds before player 2 becomes goalie. Use -1 to disable.")
    parser.add_argument("--dry-run", action="store_true", help="Print packets without sending UDP.")
    parser.add_argument("--quiet", action="store_true", help="Do not print each packet.")
    args = parser.parse_args()

    port = args.port if args.port is not None else 10000 + args.team_id
    interval = 1.0 / max(args.hz, 0.1)
    switch_tick = None if args.role_switch_at < 0 else round(args.role_switch_at * args.hz)
    max_ticks = None if args.duration == 0 else round(args.duration * args.hz)
    sock = None if args.dry_run else make_broadcast_socket()

    print(f"Sending fake team comm to {args.address}:{port} at {args.hz:.1f} Hz")
    if args.dry_run:
        print("Dry run: UDP send disabled")

    tick = 0
    try:
        while max_ticks is None or tick < max_ticks:
            roles, zones, ball_zones, confs, chase, goalie, final_ball, lead_index = game_state(tick, switch_tick)

            for sender in (1, 2, 3):
                control = role_switch(OP_NONE, 0, 0, 0)
                if switch_tick is not None and tick >= switch_tick and sender == 2:
                    control = role_switch(OP_ACK, 1, 2, ROLE_GOALIE)

                pkt = pack_team_comm(
                    sender_id=sender,
                    sender_role=roles[sender - 1],
                    robot_zones=zones,
                    ball_zones=ball_zones,
                    confidences=confs,
                    chase_scores=chase,
                    goalie_scores=goalie,
                    final_ball_zone=final_ball,
                    ready=True,
                    lead=(sender - 1) == lead_index,
                    control=control,
                )

                if sock:
                    sock.sendto(pkt, (args.address, port))
                if not args.quiet:
                    print(f"p{sender}:", hex_packet(pkt))

            tick += 1
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped")
    finally:
        if sock:
            sock.close()


if __name__ == "__main__":
    main()

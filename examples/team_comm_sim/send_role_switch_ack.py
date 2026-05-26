import argparse
import time

from team_comm_packet import (
    OP_ACK,
    OP_NONE,
    ROLE_DEFENDER,
    ROLE_GOALIE,
    hex_packet,
    make_broadcast_socket,
    pack_team_comm,
    role_switch,
)


def build_packet(player2_role, control):
    return pack_team_comm(
        sender_id=2,
        sender_role=player2_role,
        robot_zones=[0, 2, 0],
        ball_zones=[0, 0, 0],
        confidences=[0, 100, 0],
        chase_scores=[0, 90, 0],
        goalie_scores=[0, 20, 0],
        final_ball_zone=8,
        ready=True,
        lead=False,
        control=control,
    )


def main():
    parser = argparse.ArgumentParser(description="Send the player-2 defender-to-goalie ACK example packet.")
    parser.add_argument("--team-id", type=int, default=55)
    parser.add_argument("--address", default="255.255.255.255")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Print packets without sending UDP.")
    args = parser.parse_args()

    port = args.port if args.port is not None else 10000 + args.team_id
    sock = None if args.dry_run else make_broadcast_socket()

    try:
        for _ in range(5):
            pkt = build_packet(ROLE_DEFENDER, role_switch(OP_NONE, 0, 0, 0))
            if sock:
                sock.sendto(pkt, (args.address, port))
            print("p2 defender:", hex_packet(pkt))
            time.sleep(0.35)

        ack = role_switch(OP_ACK, 1, 2, ROLE_GOALIE)
        for _ in range(12):
            pkt = build_packet(ROLE_GOALIE, ack)
            if sock:
                sock.sendto(pkt, (args.address, port))
            print("p2 goalie ACK:", hex_packet(pkt))
            time.sleep(0.25)
    finally:
        if sock:
            sock.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Simulate compact team-communication packets and goalie role-switch handshakes.

This sends the same 14-byte compact UDP packet format decoded by
src/robot_communication/src/robot_communication_node.cpp.
"""

import argparse
import socket
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional


TEAM_PORT_BASE = 10000
DEFAULT_PASSWORD = 0xA7

ROLE_UNKNOWN = 0
ROLE_STRIKER = 1
ROLE_GOALIE = 2
ROLE_DEFENDER = 3

OP_NONE = 0
OP_REQUEST = 1
OP_ACK = 2
OP_CANCEL = 3

COMPACT_READY_MASK = 0x40
COMPACT_ACTIVE_BALL_ACTION_MASK = 0x80


ROLE_NAMES = {
    ROLE_UNKNOWN: "unknown",
    ROLE_STRIKER: "striker",
    ROLE_GOALIE: "goalie",
    ROLE_DEFENDER: "defender",
}

OP_NAMES = {
    OP_NONE: "none",
    OP_REQUEST: "request",
    OP_ACK: "ack",
    OP_CANCEL: "cancel",
}


@dataclass
class PlayerState:
    role: int
    zone: int
    ball_zone: int
    confidence: int
    chase_score: int
    goalie_score: int
    ready: bool = True
    lead: bool = False


@dataclass
class Phase:
    name: str
    seconds: float
    states: Dict[int, PlayerState]
    final_ball_zone: int
    controls: Dict[int, int]


def clamp_byte(value: int) -> int:
    return max(0, min(255, int(value)))


def clamp_nibble(value: int) -> int:
    return max(0, min(15, int(value)))


def require_zone(value: int) -> int:
    if value < 0 or value > 9:
        raise ValueError(f"zone must be 0..9, got {value}")
    return value


def role_switch(opcode: int, seq: int, target: int, role: int) -> int:
    if opcode == OP_NONE:
        return 0
    if opcode < OP_NONE or opcode > OP_CANCEL:
        raise ValueError(f"invalid role-switch opcode: {opcode}")
    if seq < 0 or seq > 3:
        raise ValueError(f"role-switch seq must be 0..3, got {seq}")
    if target < 1 or target > 3:
        raise ValueError(f"role-switch target must be 1..3, got {target}")
    if role != ROLE_GOALIE:
        raise ValueError("compact role-switch requests only support target role goalie")
    return (opcode << 6) | (seq << 4) | (target << 2) | role


def none_control() -> int:
    return role_switch(OP_NONE, 0, 0, ROLE_UNKNOWN)


def build_packet(
    password: int,
    sender_id: int,
    states: Dict[int, PlayerState],
    final_ball_zone: int,
    control: int,
) -> bytes:
    if sender_id not in states:
        raise ValueError(f"missing state for sender player {sender_id}")
    if sender_id < 1 or sender_id > 3:
        raise ValueError(f"sender_id must be 1..3, got {sender_id}")

    sender = states[sender_id]
    identity = sender_id | (sender.role << 4)
    if sender.ready:
        identity |= COMPACT_READY_MASK
    if sender.lead:
        identity |= COMPACT_ACTIVE_BALL_ACTION_MASK

    zones = [0, 0, 0, 0]
    ball_zones = [0, 0, 0, 0]
    confidences = [0, 0, 0, 0]
    chase_scores = [0, 0, 0, 0]
    goalie_scores = [0, 0, 0, 0]

    for player_id in range(1, 4):
        state = states[player_id]
        zones[player_id] = require_zone(state.zone)
        ball_zones[player_id] = require_zone(state.ball_zone)
        confidences[player_id] = clamp_nibble(round(state.confidence / 100.0 * 15.0))
        chase_scores[player_id] = clamp_byte(state.chase_score)
        goalie_scores[player_id] = clamp_byte(state.goalie_score)

    packet = bytearray(14)
    packet[0] = clamp_byte(password)
    packet[1] = identity
    packet[2] = (zones[1] << 4) | zones[2]
    packet[3] = (zones[3] << 4) | ball_zones[1]
    packet[4] = (ball_zones[2] << 4) | ball_zones[3]
    packet[5] = (confidences[1] << 4) | confidences[2]
    packet[6] = (confidences[3] << 4) | require_zone(final_ball_zone)
    packet[7] = chase_scores[1]
    packet[8] = chase_scores[2]
    packet[9] = chase_scores[3]
    packet[10] = goalie_scores[1]
    packet[11] = goalie_scores[2]
    packet[12] = goalie_scores[3]
    packet[13] = control
    return bytes(packet)


def hex_packet(packet: bytes) -> str:
    return " ".join(f"0x{byte:02X}" for byte in packet)


def decode_control(control: int) -> str:
    opcode = (control & 0xC0) >> 6
    seq = (control & 0x30) >> 4
    target = (control & 0x0C) >> 2
    role = control & 0x03
    return f"{OP_NAMES.get(opcode, opcode)} seq={seq} target={target} role={ROLE_NAMES.get(role, role)}"


def make_broadcast_socket() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    return sock


def parse_players(value: str) -> List[int]:
    players = []
    for raw in value.split(","):
        player = int(raw.strip())
        if player < 1 or player > 3:
            raise argparse.ArgumentTypeError("players must be a comma-separated list from 1,2,3")
        if player not in players:
            players.append(player)
    if not players:
        raise argparse.ArgumentTypeError("at least one player must be simulated")
    return players


def send_phase(
    sock: Optional[socket.socket],
    address: str,
    port: int,
    password: int,
    phase: Phase,
    simulated_players: Iterable[int],
    hz: float,
    dry_run: bool,
    verbose: bool,
) -> None:
    interval = 1.0 / hz
    iterations = 1 if dry_run and not verbose else max(1, int(round(phase.seconds * hz)))

    print(f"\n== {phase.name} ({phase.seconds:.1f}s) ==")
    for tick in range(iterations):
        for player_id in simulated_players:
            packet = build_packet(
                password=password,
                sender_id=player_id,
                states=phase.states,
                final_ball_zone=phase.final_ball_zone,
                control=phase.controls.get(player_id, none_control()),
            )
            if sock is not None:
                sock.sendto(packet, (address, port))
            if verbose or dry_run or tick == 0:
                state = phase.states[player_id]
                control = phase.controls.get(player_id, none_control())
                print(
                    f"p{player_id} {ROLE_NAMES[state.role]} "
                    f"lead={int(state.lead)} control=({decode_control(control)}) "
                    f"{hex_packet(packet)}"
                )
        if tick + 1 < iterations and not dry_run:
            time.sleep(interval)


def states(
    p1: PlayerState,
    p2: PlayerState,
    p3: PlayerState,
) -> Dict[int, PlayerState]:
    return {1: p1, 2: p2, 3: p3}


def scenario(cycles: int) -> List[Phase]:
    phases: List[Phase] = []

    normal_p2_goalie = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=5, confidence=90, chase_score=55, goalie_score=75),
        PlayerState(ROLE_GOALIE, zone=2, ball_zone=5, confidence=90, chase_score=20, goalie_score=82, lead=True),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=5, confidence=90, chase_score=72, goalie_score=22),
    )
    p2_requests_p3 = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=8, confidence=90, chase_score=65, goalie_score=75),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=8, confidence=90, chase_score=18, goalie_score=82, lead=True),
        PlayerState(ROLE_DEFENDER, zone=2, ball_zone=8, confidence=90, chase_score=78, goalie_score=20),
    )
    p3_acks = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=8, confidence=90, chase_score=65, goalie_score=75),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=8, confidence=90, chase_score=18, goalie_score=82, lead=True),
        PlayerState(ROLE_GOALIE, zone=2, ball_zone=8, confidence=90, chase_score=78, goalie_score=20),
    )
    normal_p3_goalie = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=7, confidence=90, chase_score=60, goalie_score=75),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=7, confidence=90, chase_score=25, goalie_score=82, lead=True),
        PlayerState(ROLE_GOALIE, zone=2, ball_zone=7, confidence=90, chase_score=78, goalie_score=20),
    )
    p3_requests_p2 = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=2, confidence=90, chase_score=64, goalie_score=75),
        PlayerState(ROLE_DEFENDER, zone=2, ball_zone=2, confidence=90, chase_score=82, goalie_score=18),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=2, confidence=90, chase_score=20, goalie_score=78, lead=True),
    )
    p2_acks = states(
        PlayerState(ROLE_STRIKER, zone=5, ball_zone=2, confidence=90, chase_score=64, goalie_score=75),
        PlayerState(ROLE_GOALIE, zone=2, ball_zone=2, confidence=90, chase_score=82, goalie_score=18),
        PlayerState(ROLE_DEFENDER, zone=8, ball_zone=2, confidence=90, chase_score=20, goalie_score=78, lead=True),
    )

    for cycle in range(cycles):
        seq_a = (cycle * 2 + 1) % 4
        seq_b = (cycle * 2 + 2) % 4
        if seq_a == 0:
            seq_a = 1
        if seq_b == 0:
            seq_b = 2

        phases.extend(
            [
                Phase("steady: p2 goalie, p3 defender", 3.0, normal_p2_goalie, 5, {}),
                Phase(
                    "request: p2 gives goalie role to p3",
                    1.5,
                    p2_requests_p3,
                    8,
                    {2: role_switch(OP_REQUEST, seq_a, 3, ROLE_GOALIE)},
                ),
                Phase(
                    "ack: p3 accepts goalie role",
                    2.0,
                    p3_acks,
                    8,
                    {
                        2: role_switch(OP_REQUEST, seq_a, 3, ROLE_GOALIE),
                        3: role_switch(OP_ACK, seq_a, 3, ROLE_GOALIE),
                    },
                ),
                Phase("committed: p3 goalie, p2 defender", 4.0, normal_p3_goalie, 7, {}),
                Phase(
                    "request: p3 gives goalie role back to p2",
                    1.5,
                    p3_requests_p2,
                    2,
                    {3: role_switch(OP_REQUEST, seq_b, 2, ROLE_GOALIE)},
                ),
                Phase(
                    "ack: p2 accepts goalie role",
                    2.0,
                    p2_acks,
                    2,
                    {
                        3: role_switch(OP_REQUEST, seq_b, 2, ROLE_GOALIE),
                        2: role_switch(OP_ACK, seq_b, 2, ROLE_GOALIE),
                    },
                ),
            ]
        )

    phases.append(Phase("committed: p2 goalie, p3 defender", 5.0, normal_p2_goalie, 5, {}))
    return phases


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Simulate a compact team game with proper goalie role-switch request/ACK handshakes."
    )
    parser.add_argument("--team-id", type=int, default=55)
    parser.add_argument("--address", default="255.255.255.255")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--password", type=lambda value: int(value, 0), default=DEFAULT_PASSWORD)
    parser.add_argument("--hz", type=float, default=5.0)
    parser.add_argument("--cycles", type=int, default=1)
    parser.add_argument(
        "--players",
        type=parse_players,
        default=parse_players("1,2,3"),
        help="Comma-separated simulated player IDs. Use 2,3 if player 1 is a real robot.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print packets without sending UDP.")
    parser.add_argument("--verbose", action="store_true", help="Print every packet, not just phase starts.")
    args = parser.parse_args()

    if args.hz <= 0:
        raise SystemExit("--hz must be positive")
    if args.cycles <= 0:
        raise SystemExit("--cycles must be positive")

    port = args.port if args.port is not None else TEAM_PORT_BASE + args.team_id
    sock = None if args.dry_run else make_broadcast_socket()

    print(
        f"team={args.team_id} address={args.address} port={port} "
        f"players={','.join(str(player) for player in args.players)} "
        f"password=0x{args.password & 0xFF:02X} hz={args.hz:.1f}"
    )

    try:
        for phase in scenario(args.cycles):
            send_phase(
                sock=sock,
                address=args.address,
                port=port,
                password=args.password,
                phase=phase,
                simulated_players=args.players,
                hz=args.hz,
                dry_run=args.dry_run,
                verbose=args.verbose,
            )
    finally:
        if sock is not None:
            sock.close()


if __name__ == "__main__":
    main()

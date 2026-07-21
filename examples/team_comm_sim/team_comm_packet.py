import socket

PASSWORD = 0xA7

ROLE_UNKNOWN = 0
ROLE_STRIKER = 1
ROLE_GOALIE = 2
ROLE_DEFENDER = 3

OP_NONE = 0
OP_REQUEST = 1
OP_ACK = 2
OP_CANCEL = 3

# Must match field_length/field_width defaults in robot_communication_node.cpp.
FIELD_LENGTH_M = 14.0
FIELD_WIDTH_M = 9.0


def clamp(value, low, high):
    return max(low, min(high, value))


def compact_score(value):
    return round(clamp(value, 0, 100) * 255 / 100)


def compact_confidence(value):
    return round(clamp(value, 0, 100) * 15 / 100)


def ball_coord_to_byte(coord_m, extent_m):
    normalized = (coord_m + extent_m * 0.5) / extent_m
    return round(clamp(normalized, 0.0, 1.0) * 255)


def zone_center_m(zone, field_length=FIELD_LENGTH_M, field_width=FIELD_WIDTH_M):
    if zone < 1 or zone > 9:
        return (0.0, 0.0)
    idx = zone - 1
    col = idx // 3
    row_from_top = idx % 3
    x = -field_length / 2 + field_length * (col + 0.5) / 3
    y = field_width / 2 - field_width * (row_from_top + 0.5) / 3
    return (x, y)


def identity(player_id, role, ready=True, active=False):
    return (
        (player_id & 0x0F)
        | ((role & 0x03) << 4)
        | (0x40 if ready else 0)
        | (0x80 if active else 0)
    )


def role_switch(opcode, seq, target, role):
    return (
        ((opcode & 0x03) << 6)
        | ((seq & 0x03) << 4)
        | ((target & 0x03) << 2)
        | (role & 0x03)
    )


def validate_zone(value, name):
    if value < 0 or value > 9:
        raise ValueError(f"{name} must be in 0..9, got {value}")


def pack_team_comm(
    sender_id,
    sender_role,
    robot_zones,
    ball_zones,
    confidences,
    chase_scores,
    goalie_scores,
    final_ball_zone,
    ready=True,
    lead=False,
    control=0,
    ball_pos=None,
):
    if sender_id not in (1, 2, 3):
        raise ValueError(f"sender_id must be 1, 2, or 3, got {sender_id}")
    if sender_role not in (ROLE_UNKNOWN, ROLE_STRIKER, ROLE_GOALIE, ROLE_DEFENDER):
        raise ValueError(f"sender_role must be 0..3, got {sender_role}")
    if len(robot_zones) != 3 or len(ball_zones) != 3:
        raise ValueError("robot_zones and ball_zones must each contain 3 values")
    if len(confidences) != 3 or len(chase_scores) != 3 or len(goalie_scores) != 3:
        raise ValueError("confidences, chase_scores, and goalie_scores must each contain 3 values")

    robot_zones = [int(z) for z in robot_zones]
    ball_zones = [int(z) for z in ball_zones]
    for i, zone in enumerate(robot_zones, start=1):
        validate_zone(zone, f"player {i} robot zone")
    for i, zone in enumerate(ball_zones, start=1):
        validate_zone(zone, f"player {i} ball zone")
    validate_zone(int(final_ball_zone), "final ball zone")

    conf = [compact_confidence(v) for v in confidences]
    chase = [compact_score(v) for v in chase_scores]
    goalie = [compact_score(v) for v in goalie_scores]

    # Precise ball x/y (bytes 14-15): only meaningful once final_ball_zone != 0.
    # Default to that zone's center when the caller doesn't supply a precise
    # position, so the quantized bytes stay consistent with the zone nibble.
    if final_ball_zone == 0:
        ball_x_byte, ball_y_byte = 0, 0
    else:
        ball_x_m, ball_y_m = ball_pos if ball_pos is not None else zone_center_m(final_ball_zone)
        ball_x_byte = ball_coord_to_byte(ball_x_m, FIELD_LENGTH_M)
        ball_y_byte = ball_coord_to_byte(ball_y_m, FIELD_WIDTH_M)

    return bytes([
        PASSWORD,
        identity(sender_id, sender_role, ready=ready, active=lead),
        ((robot_zones[0] & 0x0F) << 4) | (robot_zones[1] & 0x0F),
        ((robot_zones[2] & 0x0F) << 4) | (ball_zones[0] & 0x0F),
        ((ball_zones[1] & 0x0F) << 4) | (ball_zones[2] & 0x0F),
        ((conf[0] & 0x0F) << 4) | (conf[1] & 0x0F),
        ((conf[2] & 0x0F) << 4) | (final_ball_zone & 0x0F),
        chase[0],
        chase[1],
        chase[2],
        goalie[0],
        goalie[1],
        goalie[2],
        control & 0xFF,
        ball_x_byte,
        ball_y_byte,
    ])


def make_broadcast_socket():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    return sock


def hex_packet(packet):
    return " ".join(f"{b:02X}" for b in packet)

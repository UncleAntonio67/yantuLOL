from __future__ import annotations

"""
Pure-Python QR -> PNG generator (no network / no extra pip deps).

Scope:
- Byte mode only (UTF-8)
- Versions 1..10 (auto-select)
- Error correction: L/M/Q/H (default M)
- Full function patterns (finder, timing, alignment, format, version)
- Mask selection (0..7) by penalty scoring

PNG output is 8-bit grayscale with zlib compression.
"""

from dataclasses import dataclass
import binascii
import struct
import zlib


class QrCode:
    class Ecc:
        LOW = 0
        MEDIUM = 1
        QUARTILE = 2
        HIGH = 3

    def __init__(self, version: int, modules: list[list[bool]], is_func: list[list[bool]]):
        self.version = version
        self.size = version * 4 + 17
        self.modules = modules
        self.is_func = is_func

    def get_module(self, x: int, y: int) -> bool:
        return self.modules[y][x]

    @staticmethod
    def encode_text(text: str, *, ecc: int = Ecc.MEDIUM) -> "QrCode":
        data = text.encode("utf-8")
        return QrCode._encode_bytes(data, ecc=ecc)

    @staticmethod
    def _encode_bytes(data: bytes, *, ecc: int) -> "QrCode":
        bb = _BitBuffer()
        bb.append(0b0100, 4)  # byte mode

        # char count bits for byte mode
        # v1..9 => 8, v10.. => 16
        # We'll try versions 1..10 so we can decide later.

        # Try versions 1..10
        for ver in range(1, 11):
            count_bits = 8 if ver <= 9 else 16
            bb2 = _BitBuffer()
            bb2._bits = bb._bits.copy()
            bb2.append(len(data), count_bits)
            for b in data:
                bb2.append(b, 8)

            params = _ECC_TABLE.get((ver, ecc))
            if not params:
                continue
            cap_bits = params.data_codewords * 8
            if bb2.bit_length() > cap_bits:
                continue

            # Terminator
            terminator = min(4, cap_bits - bb2.bit_length())
            bb2.append(0, terminator)
            # Pad to byte
            while bb2.bit_length() % 8 != 0:
                bb2.append(0, 1)
            data_bytes = bytearray(bb2.to_bytes())
            # Pad codewords
            pad = [0xEC, 0x11]
            i = 0
            while len(data_bytes) < params.data_codewords:
                data_bytes.append(pad[i % 2])
                i += 1

            return _build_qr(ver, ecc, bytes(data_bytes))

        raise ValueError("Text too long for supported QR versions (1..10).")


class _BitBuffer:
    def __init__(self):
        self._bits: list[int] = []

    def append(self, val: int, length: int) -> None:
        if length < 0 or val >> length != 0:
            raise ValueError("Value out of range")
        for i in reversed(range(length)):
            self._bits.append((val >> i) & 1)

    def bit_length(self) -> int:
        return len(self._bits)

    def to_bytes(self) -> bytes:
        out = bytearray()
        acc = 0
        for i, b in enumerate(self._bits):
            acc = (acc << 1) | b
            if (i + 1) % 8 == 0:
                out.append(acc)
                acc = 0
        if len(self._bits) % 8 != 0:
            out.append(acc << (8 - (len(self._bits) % 8)))
        return bytes(out)


@dataclass(frozen=True)
class _EccParams:
    data_codewords: int
    ecc_codewords_per_block: int
    num_blocks: int


# (version, ecc) -> params
_ECC_TABLE: dict[tuple[int, int], _EccParams] = {
    (1, QrCode.Ecc.LOW): _EccParams(19, 7, 1),
    (1, QrCode.Ecc.MEDIUM): _EccParams(16, 10, 1),
    (1, QrCode.Ecc.QUARTILE): _EccParams(13, 13, 1),
    (1, QrCode.Ecc.HIGH): _EccParams(9, 17, 1),
    (2, QrCode.Ecc.LOW): _EccParams(34, 10, 1),
    (2, QrCode.Ecc.MEDIUM): _EccParams(28, 16, 1),
    (2, QrCode.Ecc.QUARTILE): _EccParams(22, 22, 1),
    (2, QrCode.Ecc.HIGH): _EccParams(16, 28, 1),
    (3, QrCode.Ecc.LOW): _EccParams(55, 15, 1),
    (3, QrCode.Ecc.MEDIUM): _EccParams(44, 26, 1),
    (3, QrCode.Ecc.QUARTILE): _EccParams(34, 18, 2),
    (3, QrCode.Ecc.HIGH): _EccParams(26, 22, 2),
    (4, QrCode.Ecc.LOW): _EccParams(80, 20, 1),
    (4, QrCode.Ecc.MEDIUM): _EccParams(64, 18, 2),
    (4, QrCode.Ecc.QUARTILE): _EccParams(48, 26, 2),
    (4, QrCode.Ecc.HIGH): _EccParams(36, 16, 4),
    (5, QrCode.Ecc.LOW): _EccParams(108, 26, 1),
    (5, QrCode.Ecc.MEDIUM): _EccParams(86, 24, 2),
    (5, QrCode.Ecc.QUARTILE): _EccParams(62, 18, 4),
    (5, QrCode.Ecc.HIGH): _EccParams(46, 22, 4),
    (6, QrCode.Ecc.LOW): _EccParams(136, 18, 2),
    (6, QrCode.Ecc.MEDIUM): _EccParams(108, 16, 4),
    (6, QrCode.Ecc.QUARTILE): _EccParams(76, 24, 4),
    (6, QrCode.Ecc.HIGH): _EccParams(60, 28, 4),
    (7, QrCode.Ecc.LOW): _EccParams(156, 20, 2),
    (7, QrCode.Ecc.MEDIUM): _EccParams(124, 18, 4),
    (7, QrCode.Ecc.QUARTILE): _EccParams(88, 18, 6),
    (7, QrCode.Ecc.HIGH): _EccParams(66, 26, 5),
    (8, QrCode.Ecc.LOW): _EccParams(194, 24, 2),
    (8, QrCode.Ecc.MEDIUM): _EccParams(154, 22, 4),
    (8, QrCode.Ecc.QUARTILE): _EccParams(110, 22, 6),
    (8, QrCode.Ecc.HIGH): _EccParams(86, 26, 6),
    (9, QrCode.Ecc.LOW): _EccParams(232, 30, 2),
    (9, QrCode.Ecc.MEDIUM): _EccParams(182, 22, 5),
    (9, QrCode.Ecc.QUARTILE): _EccParams(132, 20, 8),
    (9, QrCode.Ecc.HIGH): _EccParams(100, 24, 8),
    (10, QrCode.Ecc.LOW): _EccParams(274, 18, 4),
    (10, QrCode.Ecc.MEDIUM): _EccParams(216, 26, 5),
    (10, QrCode.Ecc.QUARTILE): _EccParams(154, 24, 8),
    (10, QrCode.Ecc.HIGH): _EccParams(122, 28, 8),
}


_ALIGN_POS: dict[int, list[int]] = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
}


def _build_qr(version: int, ecc: int, data_codewords: bytes) -> QrCode:
    params = _ECC_TABLE[(version, ecc)]
    if len(data_codewords) != params.data_codewords:
        raise ValueError("Unexpected data length")

    # RS blocks (assume equal-size blocks for this version range)
    per = params.data_codewords // params.num_blocks
    if per * params.num_blocks != params.data_codewords:
        raise ValueError("Unsupported block structure for this version/ecc")

    blocks: list[bytes] = []
    ecc_blocks: list[bytes] = []
    for i in range(params.num_blocks):
        block = data_codewords[i * per : (i + 1) * per]
        blocks.append(block)
        ecc_blocks.append(_reed_solomon_compute(block, params.ecc_codewords_per_block))

    interleaved = bytearray()
    for i in range(per):
        for b in blocks:
            interleaved.append(b[i])
    for i in range(params.ecc_codewords_per_block):
        for eb in ecc_blocks:
            interleaved.append(eb[i])

    size = version * 4 + 17
    mod = [[False] * size for _ in range(size)]
    is_func = [[False] * size for _ in range(size)]
    _draw_function_patterns(mod, is_func, version)

    _draw_codewords(mod, is_func, bytes(interleaved))

    # Choose best mask
    best_mask = 0
    best_penalty = 10**18
    for mask in range(8):
        tmp = [row.copy() for row in mod]
        _apply_mask(tmp, is_func, mask)
        _draw_format_bits(tmp, is_func, ecc, mask)
        if version >= 7:
            _draw_version_bits(tmp, is_func, version)
        pen = _penalty_score(tmp)
        if pen < best_penalty:
            best_penalty = pen
            best_mask = mask

    _apply_mask(mod, is_func, best_mask)
    _draw_format_bits(mod, is_func, ecc, best_mask)
    if version >= 7:
        _draw_version_bits(mod, is_func, version)

    return QrCode(version, mod, is_func)


def _set_func(mod: list[list[bool]], is_func: list[list[bool]], x: int, y: int, v: bool) -> None:
    mod[y][x] = v
    is_func[y][x] = True


def _draw_function_patterns(mod: list[list[bool]], is_func: list[list[bool]], version: int) -> None:
    size = version * 4 + 17

    # Finder patterns + separators
    for (ox, oy) in [(0, 0), (size - 7, 0), (0, size - 7)]:
        for dy in range(-1, 8):
            for dx in range(-1, 8):
                x = ox + dx
                y = oy + dy
                if 0 <= x < size and 0 <= y < size:
                    on = (
                        0 <= dx <= 6
                        and 0 <= dy <= 6
                        and (
                            dx in (0, 6)
                            or dy in (0, 6)
                            or (2 <= dx <= 4 and 2 <= dy <= 4)
                        )
                    )
                    _set_func(mod, is_func, x, y, on)

    # Timing patterns
    for i in range(8, size - 8):
        v = (i % 2 == 0)
        _set_func(mod, is_func, i, 6, v)
        _set_func(mod, is_func, 6, i, v)

    # Alignment patterns
    for cx in _ALIGN_POS.get(version, []):
        for cy in _ALIGN_POS.get(version, []):
            # Skip overlaps with finders
            if (cx == 6 and cy == 6) or (cx == 6 and cy == size - 7) or (cx == size - 7 and cy == 6):
                continue
            _draw_alignment(mod, is_func, cx, cy)

    # Dark module
    _set_func(mod, is_func, 8, size - 8, True)

    # Reserve format information areas
    for i in range(9):
        if i != 6:
            _set_func(mod, is_func, 8, i, False)
            _set_func(mod, is_func, i, 8, False)
    for i in range(8):
        _set_func(mod, is_func, size - 1 - i, 8, False)
        _set_func(mod, is_func, 8, size - 1 - i, False)

    # Reserve version information areas
    if version >= 7:
        for y in range(6):
            for x in range(3):
                _set_func(mod, is_func, size - 11 + x, y, False)
                _set_func(mod, is_func, x, size - 11 + y, False)


def _draw_alignment(mod: list[list[bool]], is_func: list[list[bool]], cx: int, cy: int) -> None:
    # 5x5 pattern
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            x = cx + dx
            y = cy + dy
            on = max(abs(dx), abs(dy)) != 1
            _set_func(mod, is_func, x, y, on)


def _draw_codewords(mod: list[list[bool]], is_func: list[list[bool]], data: bytes) -> None:
    size = len(mod)
    bits: list[int] = []
    for b in data:
        for i in reversed(range(8)):
            bits.append((b >> i) & 1)

    i = 0
    x = size - 1
    y = size - 1
    dir_ = -1
    while x > 0:
        if x == 6:
            x -= 1
        while True:
            for dx in [0, -1]:
                xx = x + dx
                if not is_func[y][xx]:
                    mod[y][xx] = (bits[i] == 1) if i < len(bits) else False
                    i += 1
            y += dir_
            if y < 0 or y >= size:
                y -= dir_
                dir_ = -dir_
                break
        x -= 2


def _mask_bit(mask: int, x: int, y: int) -> bool:
    if mask == 0:
        return ((x + y) & 1) == 0
    if mask == 1:
        return (y & 1) == 0
    if mask == 2:
        return (x % 3) == 0
    if mask == 3:
        return ((x + y) % 3) == 0
    if mask == 4:
        return (((y // 2) + (x // 3)) & 1) == 0
    if mask == 5:
        return ((x * y) % 2 + (x * y) % 3) == 0
    if mask == 6:
        return (((x * y) % 2 + (x * y) % 3) & 1) == 0
    if mask == 7:
        return ((((x + y) % 2) + ((x * y) % 3)) & 1) == 0
    raise ValueError("invalid mask")


def _apply_mask(mod: list[list[bool]], is_func: list[list[bool]], mask: int) -> None:
    size = len(mod)
    for y in range(size):
        for x in range(size):
            if is_func[y][x]:
                continue
            if _mask_bit(mask, x, y):
                mod[y][x] = not mod[y][x]


def _format_bits(ecc: int, mask: int) -> int:
    ecl_bits = {QrCode.Ecc.LOW: 1, QrCode.Ecc.MEDIUM: 0, QrCode.Ecc.QUARTILE: 3, QrCode.Ecc.HIGH: 2}[ecc]
    data = (ecl_bits << 3) | mask  # 5 bits
    # BCH remainder of (data << 10) mod 0x537
    rem = data << 10
    poly = 0x537
    for i in range(14, 9, -1):
        if ((rem >> i) & 1) != 0:
            rem ^= poly << (i - 10)
    bits = ((data << 10) | (rem & 0x3FF)) ^ 0x5412
    return bits & 0x7FFF


def _draw_format_bits(mod: list[list[bool]], is_func: list[list[bool]], ecc: int, mask: int) -> None:
    size = len(mod)
    bits = _format_bits(ecc, mask)

    # 0..5 -> (8,0..5)
    for i in range(6):
        _set_func(mod, is_func, 8, i, ((bits >> i) & 1) == 1)
    _set_func(mod, is_func, 8, 7, ((bits >> 6) & 1) == 1)
    _set_func(mod, is_func, 8, 8, ((bits >> 7) & 1) == 1)
    _set_func(mod, is_func, 7, 8, ((bits >> 8) & 1) == 1)
    for i in range(6):
        _set_func(mod, is_func, 5 - i, 8, ((bits >> (9 + i)) & 1) == 1)

    # The other copy
    for i in range(8):
        _set_func(mod, is_func, size - 1 - i, 8, ((bits >> i) & 1) == 1)
    for i in range(7):
        _set_func(mod, is_func, 8, size - 1 - i, ((bits >> (8 + i)) & 1) == 1)


def _version_bits(version: int) -> int:
    # BCH remainder of (version << 12) mod 0x1F25
    rem = version << 12
    poly = 0x1F25
    for i in range(17, 11, -1):
        if ((rem >> i) & 1) != 0:
            rem ^= poly << (i - 12)
    return ((version << 12) | (rem & 0xFFF)) & 0x3FFFF


def _draw_version_bits(mod: list[list[bool]], is_func: list[list[bool]], version: int) -> None:
    size = len(mod)
    bits = _version_bits(version)
    for i in range(18):
        bit = ((bits >> i) & 1) == 1
        a = size - 11 + (i % 3)
        b = i // 3
        _set_func(mod, is_func, a, b, bit)
        _set_func(mod, is_func, b, a, bit)


def _penalty_score(mod: list[list[bool]]) -> int:
    size = len(mod)
    score = 0

    # Rule 1: runs
    for y in range(size):
        run_color = mod[y][0]
        run_len = 1
        for x in range(1, size):
            if mod[y][x] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_color = mod[y][x]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    for x in range(size):
        run_color = mod[0][x]
        run_len = 1
        for y in range(1, size):
            if mod[y][x] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_color = mod[y][x]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    # Rule 2: 2x2 blocks
    for y in range(size - 1):
        for x in range(size - 1):
            c = mod[y][x]
            if mod[y][x + 1] == c and mod[y + 1][x] == c and mod[y + 1][x + 1] == c:
                score += 3

    # Rule 3: finder-like patterns in rows/cols
    # Pattern: 10111010000 (1:3:1:1:1 ratio) with 4 white modules either side
    def has_pat(seq: list[bool], i: int) -> bool:
        # 10111010000
        pat = [True, False, True, True, True, False, True, False, False, False, False]
        if i + len(pat) > len(seq):
            return False
        return all(seq[i + k] == pat[k] for k in range(len(pat)))

    def has_pat_rev(seq: list[bool], i: int) -> bool:
        # 00001011101
        pat = [False, False, False, False, True, False, True, True, True, False, True]
        if i + len(pat) > len(seq):
            return False
        return all(seq[i + k] == pat[k] for k in range(len(pat)))

    for y in range(size):
        row = mod[y]
        for x in range(size - 10):
            if has_pat(row, x) or has_pat_rev(row, x):
                score += 40

    for x in range(size):
        col = [mod[y][x] for y in range(size)]
        for y in range(size - 10):
            if has_pat(col, y) or has_pat_rev(col, y):
                score += 40

    # Rule 4: balance
    dark = sum(1 for y in range(size) for x in range(size) if mod[y][x])
    total = size * size
    percent = (dark * 100) // total
    k = abs(percent - 50) // 5
    score += int(k) * 10

    return score


# ---- Reed-Solomon (GF256) ----

_GF_EXP = [0] * 512
_GF_LOG = [0] * 256
_x = 1
for i in range(255):
    _GF_EXP[i] = _x
    _GF_LOG[_x] = i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for i in range(255, 512):
    _GF_EXP[i] = _GF_EXP[i - 255]


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]


def _poly_mul(p: list[int], q: list[int]) -> list[int]:
    out = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        for j, b in enumerate(q):
            out[i + j] ^= _gf_mul(a, b)
    return out


def _reed_solomon_compute(data: bytes, ecc_len: int) -> bytes:
    gen = [1]
    for i in range(ecc_len):
        gen = _poly_mul(gen, [1, _GF_EXP[i]])
    res = [0] * ecc_len
    for b in data:
        factor = b ^ res[0]
        res = res[1:] + [0]
        for j in range(ecc_len):
            res[j] ^= _gf_mul(gen[j + 1], factor)
    return bytes(res)


# ---- PNG writer ----


def make_qr_png_bytes(text: str, *, scale: int = 8, border: int = 4, ecc: int = QrCode.Ecc.MEDIUM) -> bytes:
    qr = QrCode.encode_text(text, ecc=ecc)
    return _qr_to_png(qr, scale=scale, border=border)


def _qr_to_png(qr: QrCode, *, scale: int, border: int) -> bytes:
    if scale <= 0:
        raise ValueError("scale must be positive")
    if border < 0:
        raise ValueError("border must be >= 0")

    size = qr.size
    width = (size + border * 2) * scale
    height = width

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter byte (None)
        my = y // scale - border
        for x in range(width):
            mx = x // scale - border
            on = 0 <= mx < size and 0 <= my < size and qr.get_module(mx, my)
            raw.append(0 if on else 255)

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 0, 0, 0, 0)  # 8-bit grayscale
    idat = zlib.compress(bytes(raw), level=9)

    out = bytearray()
    out += b"\x89PNG\r\n\x1a\n"
    out += _chunk(b"IHDR", ihdr)
    out += _chunk(b"IDAT", idat)
    out += _chunk(b"IEND", b"")
    return bytes(out)


def _chunk(kind: bytes, data: bytes) -> bytes:
    ln = struct.pack("!I", len(data))
    crc = struct.pack("!I", binascii.crc32(kind + data) & 0xFFFFFFFF)
    return ln + kind + data + crc


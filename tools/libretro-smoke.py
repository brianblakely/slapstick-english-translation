#!/usr/bin/env python3
"""Small deterministic libretro runner for Slap Stick runtime tests.

It loads a core directly, feeds scheduled RetroPad inputs, records framebuffer
snapshots, and hashes video/WRAM/save-state data at regular intervals.  This
keeps translation smoke tests independent of RetroArch's desktop UI.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import signal
from pathlib import Path
from typing import Final


class RetroSystemInfo(ctypes.Structure):
    _fields_ = [
        ("library_name", ctypes.c_char_p),
        ("library_version", ctypes.c_char_p),
        ("valid_extensions", ctypes.c_char_p),
        ("need_fullpath", ctypes.c_bool),
        ("block_extract", ctypes.c_bool),
    ]


class RetroGameInfo(ctypes.Structure):
    _fields_ = [
        ("path", ctypes.c_char_p),
        ("data", ctypes.c_void_p),
        ("size", ctypes.c_size_t),
        ("meta", ctypes.c_char_p),
    ]


class RetroGameGeometry(ctypes.Structure):
    _fields_ = [
        ("base_width", ctypes.c_uint),
        ("base_height", ctypes.c_uint),
        ("max_width", ctypes.c_uint),
        ("max_height", ctypes.c_uint),
        ("aspect_ratio", ctypes.c_float),
    ]


class RetroSystemTiming(ctypes.Structure):
    _fields_ = [("fps", ctypes.c_double), ("sample_rate", ctypes.c_double)]


class RetroSystemAVInfo(ctypes.Structure):
    _fields_ = [("geometry", RetroGameGeometry), ("timing", RetroSystemTiming)]


class RetroVariable(ctypes.Structure):
    _fields_ = [("key", ctypes.c_char_p), ("value", ctypes.c_char_p)]


ENVIRONMENT = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_uint, ctypes.c_void_p)
VIDEO_REFRESH = ctypes.CFUNCTYPE(
    None, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_size_t
)
AUDIO_SAMPLE = ctypes.CFUNCTYPE(None, ctypes.c_int16, ctypes.c_int16)
AUDIO_BATCH = ctypes.CFUNCTYPE(
    ctypes.c_size_t, ctypes.POINTER(ctypes.c_int16), ctypes.c_size_t
)
INPUT_POLL = ctypes.CFUNCTYPE(None)
INPUT_STATE = ctypes.CFUNCTYPE(
    ctypes.c_int16, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint
)

RETRO_DEVICE_JOYPAD: Final = 1
RETRO_DEVICE_ID_JOYPAD_MASK: Final = 256
RETRO_MEMORY_SYSTEM_RAM: Final = 2
BUTTONS: Final = {
    "b": 0,
    "y": 1,
    "select": 2,
    "start": 3,
    "up": 4,
    "down": 5,
    "left": 6,
    "right": 7,
    "a": 8,
    "x": 9,
    "l": 10,
    "r": 11,
}


class Frontend:
    def __init__(self, output_dir: Path, snapshot_every: int):
        self.output_dir = output_dir
        self.snapshot_every = snapshot_every
        self.frame = 0
        self.input_mask = 0
        self.pixel_format = 0
        self.shutdown = False
        self.framebuffer: tuple[bytes, int, int, int, int] | None = None
        self.environment_commands: set[int] = set()
        self.directory = str(output_dir.resolve()).encode()

        # Keep callback objects alive for the lifetime of the core.
        self.environment_callback = ENVIRONMENT(self.environment)
        self.video_callback = VIDEO_REFRESH(self.video_refresh)
        self.audio_callback = AUDIO_SAMPLE(self.audio_sample)
        self.audio_batch_callback = AUDIO_BATCH(self.audio_batch)
        self.input_poll_callback = INPUT_POLL(self.input_poll)
        self.input_state_callback = INPUT_STATE(self.input_state)

    def environment(self, command: int, data: int) -> bool:
        self.environment_commands.add(command)
        if command == 1:  # SET_ROTATION
            return True
        if command == 2:  # GET_OVERSCAN
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = False
            return True
        if command == 3:  # GET_CAN_DUPE
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = True
            return True
        if command == 7:  # SHUTDOWN
            self.shutdown = True
            return True
        if command in (9, 30, 31):  # system, core-assets, and save directories
            ctypes.cast(data, ctypes.POINTER(ctypes.c_char_p))[0] = self.directory
            return True
        if command == 10:  # SET_PIXEL_FORMAT
            self.pixel_format = ctypes.cast(data, ctypes.POINTER(ctypes.c_int))[0]
            return self.pixel_format in (0, 1, 2)
        if command == 15:  # GET_VARIABLE: use each core option's default
            ctypes.cast(data, ctypes.POINTER(RetroVariable))[0].value = None
            # A true return means the core may dereference value immediately.
            # False explicitly requests the core's built-in default.
            return False
        if command == 17:  # GET_VARIABLE_UPDATE
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = False
            return True
        if command == 39:  # GET_LANGUAGE
            ctypes.cast(data, ctypes.POINTER(ctypes.c_uint))[0] = 0
            return True
        if command == 47:  # GET_AUDIO_VIDEO_ENABLE
            ctypes.cast(data, ctypes.POINTER(ctypes.c_int))[0] = 3
            return True
        if command == 49:  # GET_FASTFORWARDING
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = False
            return True
        if command == 50:  # GET_TARGET_REFRESH_RATE
            ctypes.cast(data, ctypes.POINTER(ctypes.c_float))[0] = 60.0
            return True
        if command == 51:  # GET_INPUT_BITMASKS
            return True
        # Descriptor, option, geometry, and metadata setters need no frontend work.
        if command in (6, 8, 11, 16, 18, 32, 34, 35, 37, 42):
            return True
        return False

    def video_refresh(
        self, data: int, width: int, height: int, pitch: int
    ) -> None:
        if not data:
            return
        if self.frame % self.snapshot_every == 0:
            self.framebuffer = (
                ctypes.string_at(data, pitch * height),
                width,
                height,
                pitch,
                self.pixel_format,
            )

    @staticmethod
    def audio_sample(_left: int, _right: int) -> None:
        return None

    @staticmethod
    def audio_batch(_data: ctypes.POINTER(ctypes.c_int16), frames: int) -> int:
        return frames

    @staticmethod
    def input_poll() -> None:
        return None

    def input_state(
        self, port: int, device: int, _index: int, button_id: int
    ) -> int:
        if port != 0 or device != RETRO_DEVICE_JOYPAD:
            return 0
        if button_id == RETRO_DEVICE_ID_JOYPAD_MASK:
            return ctypes.c_int16(self.input_mask).value
        return 1 if self.input_mask & (1 << button_id) else 0


def configure_core(core: ctypes.CDLL) -> None:
    core.retro_set_environment.argtypes = [ENVIRONMENT]
    core.retro_set_video_refresh.argtypes = [VIDEO_REFRESH]
    core.retro_set_audio_sample.argtypes = [AUDIO_SAMPLE]
    core.retro_set_audio_sample_batch.argtypes = [AUDIO_BATCH]
    core.retro_set_input_poll.argtypes = [INPUT_POLL]
    core.retro_set_input_state.argtypes = [INPUT_STATE]
    core.retro_get_system_info.argtypes = [ctypes.POINTER(RetroSystemInfo)]
    core.retro_get_system_av_info.argtypes = [ctypes.POINTER(RetroSystemAVInfo)]
    core.retro_load_game.argtypes = [ctypes.POINTER(RetroGameInfo)]
    core.retro_load_game.restype = ctypes.c_bool
    core.retro_set_controller_port_device.argtypes = [ctypes.c_uint, ctypes.c_uint]
    core.retro_get_memory_data.argtypes = [ctypes.c_uint]
    core.retro_get_memory_data.restype = ctypes.c_void_p
    core.retro_get_memory_size.argtypes = [ctypes.c_uint]
    core.retro_get_memory_size.restype = ctypes.c_size_t
    core.retro_serialize_size.restype = ctypes.c_size_t
    core.retro_serialize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    core.retro_serialize.restype = ctypes.c_bool
    core.retro_unserialize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    core.retro_unserialize.restype = ctypes.c_bool


def parse_pulses(values: list[str]) -> list[tuple[int, int, int]]:
    pulses = []
    for value in values:
        try:
            name, frame_text, duration_text = value.lower().split(":")
            button = BUTTONS[name]
            start = int(frame_text)
            duration = int(duration_text)
        except (KeyError, ValueError) as error:
            raise SystemExit(
                f"Invalid pulse {value!r}; expected button:start:duration"
            ) from error
        pulses.append((button, start, start + duration))
    return pulses


def parse_repeats(values: list[str]) -> list[tuple[int, int, int]]:
    pulses = []
    for value in values:
        try:
            name, start_text, stop_text, period_text, duration_text = value.lower().split(":")
            button = BUTTONS[name]
            start = int(start_text)
            stop = int(stop_text)
            period = int(period_text)
            duration = int(duration_text)
            if start < 0 or stop < start or period <= 0 or not 0 < duration <= period:
                raise ValueError
        except (KeyError, ValueError) as error:
            raise SystemExit(
                f"Invalid repeat {value!r}; expected button:start:stop:period:duration"
            ) from error
        for frame in range(start, stop + 1, period):
            pulses.append((button, frame, frame + duration))
    return pulses


def write_ppm(path: Path, framebuffer: tuple[bytes, int, int, int, int]) -> str:
    data, width, height, pitch, pixel_format = framebuffer
    output = bytearray(width * height * 3)
    for y in range(height):
        for x in range(width):
            if pixel_format == 1:  # XRGB8888
                value = int.from_bytes(data[y * pitch + x * 4 : y * pitch + x * 4 + 4], "little")
                red, green, blue = (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF
            else:
                value = int.from_bytes(data[y * pitch + x * 2 : y * pitch + x * 2 + 2], "little")
                if pixel_format == 2:  # RGB565
                    red = ((value >> 11) & 0x1F) * 255 // 31
                    green = ((value >> 5) & 0x3F) * 255 // 63
                    blue = (value & 0x1F) * 255 // 31
                else:  # 0RGB1555
                    red = ((value >> 10) & 0x1F) * 255 // 31
                    green = ((value >> 5) & 0x1F) * 255 // 31
                    blue = (value & 0x1F) * 255 // 31
            target = (y * width + x) * 3
            output[target : target + 3] = bytes((red, green, blue))
    path.write_bytes(f"P6\n{width} {height}\n255\n".encode() + output)
    return hashlib.sha256(data).hexdigest()


def memory_hash(core: ctypes.CDLL, memory_type: int) -> tuple[str | None, int]:
    size = core.retro_get_memory_size(memory_type)
    pointer = core.retro_get_memory_data(memory_type)
    if not pointer or not size:
        return None, 0
    return hashlib.sha256(ctypes.string_at(pointer, size)).hexdigest(), size


def state_hash(core: ctypes.CDLL, size: int, buffer: ctypes.Array) -> str | None:
    if not size or not core.retro_serialize(buffer, size):
        return None
    return hashlib.sha256(buffer.raw[:size]).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument(
        "--core",
        type=Path,
        default=Path(
            os.environ.get(
                "SNES9X_LIBRETRO_CORE", "/usr/lib/libretro/snes9x_libretro.so"
            )
        ),
    )
    parser.add_argument("--frames", type=int, default=1800)
    parser.add_argument("--snapshot-every", type=int, default=120)
    parser.add_argument("--pulse", action="append", default=[], help="button:start:duration")
    parser.add_argument(
        "--repeat",
        action="append",
        default=[],
        help="button:start:stop:period:duration",
    )
    parser.add_argument("--trap-at", type=int, help="raise SIGTRAP after this frame for GDB")
    parser.add_argument("--dump-wram-at", action="append", type=int, default=[])
    parser.add_argument("--load-state", type=Path)
    parser.add_argument("--save-state-at", action="append", type=int, default=[])
    parser.add_argument(
        "--save-state-output",
        type=Path,
        help="serialize the final frame directly to this path",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.frames < 0:
        raise SystemExit("--frames must not be negative")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    pulses = parse_pulses(args.pulse) + parse_repeats(args.repeat)
    core = ctypes.CDLL(str(args.core.resolve()))
    configure_core(core)
    frontend = Frontend(args.output_dir, args.snapshot_every)
    core.retro_set_environment(frontend.environment_callback)
    core.retro_set_video_refresh(frontend.video_callback)
    core.retro_set_audio_sample(frontend.audio_callback)
    core.retro_set_audio_sample_batch(frontend.audio_batch_callback)
    core.retro_set_input_poll(frontend.input_poll_callback)
    core.retro_set_input_state(frontend.input_state_callback)

    core.retro_init()
    rom_bytes = args.rom.read_bytes()
    rom_buffer = ctypes.create_string_buffer(rom_bytes)
    game = RetroGameInfo(
        str(args.rom.resolve()).encode(),
        ctypes.cast(rom_buffer, ctypes.c_void_p),
        len(rom_bytes),
        None,
    )
    if not core.retro_load_game(ctypes.byref(game)):
        core.retro_deinit()
        raise SystemExit("The libretro core rejected the ROM")
    core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD)

    info = RetroSystemInfo()
    av_info = RetroSystemAVInfo()
    core.retro_get_system_info(ctypes.byref(info))
    core.retro_get_system_av_info(ctypes.byref(av_info))
    serialize_size = core.retro_serialize_size()
    serialize_buffer = ctypes.create_string_buffer(serialize_size)
    if args.load_state:
        state_bytes = args.load_state.read_bytes()
        if len(state_bytes) != serialize_size:
            raise SystemExit(
                f"Save state is {len(state_bytes)} bytes; expected {serialize_size}"
            )
        state_buffer = ctypes.create_string_buffer(state_bytes)
        if not core.retro_unserialize(state_buffer, serialize_size):
            raise SystemExit("The libretro core rejected the save state")
    samples = []
    wram_size = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM)

    try:
        for frame in range(args.frames + 1):
            frontend.frame = frame
            frontend.input_mask = 0
            for button, start, end in pulses:
                if start <= frame < end:
                    frontend.input_mask |= 1 << button
            core.retro_run()
            if frame in args.dump_wram_at:
                wram_size = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM)
                wram_pointer = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)
                if wram_pointer and wram_size:
                    (args.output_dir / f"wram-{frame:06d}.bin").write_bytes(
                        ctypes.string_at(wram_pointer, wram_size)
                    )
            if frame in args.save_state_at:
                if not core.retro_serialize(serialize_buffer, serialize_size):
                    raise RuntimeError("The libretro core could not serialize state")
                (args.output_dir / f"state-{frame:06d}.bin").write_bytes(
                    serialize_buffer.raw[:serialize_size]
                )
            if args.trap_at == frame:
                signal.raise_signal(signal.SIGTRAP)
            if frame % args.snapshot_every == 0 and frontend.framebuffer:
                ppm_path = args.output_dir / f"frame-{frame:06d}.ppm"
                video_hash = write_ppm(ppm_path, frontend.framebuffer)
                wram_hash, wram_size = memory_hash(core, RETRO_MEMORY_SYSTEM_RAM)
                samples.append(
                    {
                        "frame": frame,
                        "inputMask": frontend.input_mask,
                        "videoSha256": video_hash,
                        "wramSha256": wram_hash,
                        "stateSha256": state_hash(core, serialize_size, serialize_buffer),
                    }
                )
            if frontend.shutdown:
                break
        if args.save_state_output:
            if not core.retro_serialize(serialize_buffer, serialize_size):
                raise RuntimeError("The libretro core could not serialize final state")
            args.save_state_output.parent.mkdir(parents=True, exist_ok=True)
            args.save_state_output.write_bytes(serialize_buffer.raw[:serialize_size])
    finally:
        core.retro_unload_game()
        core.retro_deinit()

    report = {
        "core": {
            "name": info.library_name.decode() if info.library_name else None,
            "version": info.library_version.decode() if info.library_version else None,
        },
        "rom": str(args.rom),
        "framesRun": frame + 1,
        "fps": av_info.timing.fps,
        "geometry": [av_info.geometry.base_width, av_info.geometry.base_height],
        "pixelFormat": frontend.pixel_format,
        "wramSize": wram_size,
        "serializeSize": serialize_size,
        "finalState": str(args.save_state_output) if args.save_state_output else None,
        "environmentCommands": sorted(frontend.environment_commands),
        "samples": samples,
    }
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3

import runpy
import unittest
from pathlib import Path


RUNNER = runpy.run_path(Path(__file__).with_name("libretro-smoke.py"))
parse_wram_conditions = RUNNER["parse_wram_conditions"]
read_wram_condition = RUNNER["read_wram_condition"]


class WramConditionTest(unittest.TestCase):
    def test_parses_numeric_forms_and_compares_little_endian_values(self) -> None:
        conditions = parse_wram_conditions(
            ["$10:1:eq:$7F", "0x20:2:ge:0x1234", "48:4:lt:100000"]
        )
        memory = bytearray(0x20000)
        memory[0x10] = 0x7F
        memory[0x20:0x22] = (0x1235).to_bytes(2, "little")
        memory[48:52] = (99999).to_bytes(4, "little")
        self.assertTrue(all(read_wram_condition(memory, item)[1] for item in conditions))

    def test_supports_all_comparison_operators(self) -> None:
        memory = bytes([5])
        for operator, expected, matches in (
            ("eq", 5, True),
            ("ne", 4, True),
            ("lt", 6, True),
            ("le", 5, True),
            ("gt", 4, True),
            ("ge", 5, True),
        ):
            condition = {
                "address": 0,
                "width": 1,
                "operator": operator,
                "expected": expected,
            }
            self.assertEqual(read_wram_condition(memory, condition), (5, matches))

    def test_rejects_invalid_conditions(self) -> None:
        for value in (
            "0:3:eq:0",
            "0:1:wat:0",
            "0x20000:1:eq:0",
            "0:1:eq:0x100",
            "missing-fields",
        ):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                parse_wram_conditions([value])


if __name__ == "__main__":
    unittest.main()

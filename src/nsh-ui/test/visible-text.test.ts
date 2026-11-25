// The streaming visibility check agrees with `trim()` without copying the reply.
import { expect, test } from "nsh/test";
import { hasVisibleTextFrom } from "../src/agentEvents";

test("hasVisibleTextFrom judges whitespace exactly as trim() does", () => {
  const samples = [
    "", " ", "\t\n\r\v\f", " ﻿       　",
    "a", "  a", "\u0085", "\u001f", "​", "中", "\n\n# Title", "  x",
  ];
  for (const text of samples) {
    for (let from = 0; from <= text.length + 1; from += 1) {
      expect(hasVisibleTextFrom(text, from)).toBe(text.slice(from).trim().length > 0);
    }
  }
});

import { describe, expect, test } from "vitest";

import { validateSchedule } from "../src/config.js";
import { sanitizeFilename } from "../src/utils.js";

describe("basic install-adjacent helpers", () => {
  test("keeps filenames reasonable", () => {
    expect(sanitizeFilename("Amazon OTP / Alerts")).toBe("Amazon OTP - Alerts");
  });

  test("validates schedule", () => {
    expect(validateSchedule("05:30")).toEqual({ hour: 5, minute: 30 });
    expect(() => validateSchedule("25:99")).toThrow();
    expect(() => validateSchedule("nope")).toThrow();
  });
});

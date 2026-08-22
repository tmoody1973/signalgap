import { describe, expect, it } from "vitest";
import { MARKET_KEY } from "@/lib/constants";

describe("smoke", () => {
  it("knows the frozen market", () => {
    expect(MARKET_KEY).toBe("milwaukee-wi");
  });
});

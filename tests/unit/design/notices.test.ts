import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const untitledDir = path.join(root, "src/components/ui/untitled");
const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

describe("third-party notices", () => {
  it("records every copied Untitled UI component", () => {
    const files = readdirSync(untitledDir).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(notices, `${file} missing from THIRD_PARTY_NOTICES.md`).toContain(`\`${file}\``);
    }
  });

  it("contains no PRO source markers", () => {
    const files = readdirSync(untitledDir).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      const src = readFileSync(path.join(untitledDir, file), "utf8");
      expect(src).not.toMatch(/Untitled UI PRO|untitledui\.com\/pro/i);
    }
  });
});

import { describe, expect, it } from "vitest";
import { vExclusionReason } from "../../convex/lib/validators";
import { EXCLUSION_REASON_SHORT, EXCLUSION_REASON_TEXT, exclusionChips, exclusionSentence } from "@/lib/exclusion-reasons";

const ALL = Object.keys(EXCLUSION_REASON_TEXT) as (keyof typeof EXCLUSION_REASON_TEXT)[];

describe("exclusion reasons", () => {
  it("covers every reason the rules engine can emit", () => {
    // The validator is the engine's own list. A reason with no sentence would
    // render as a blank line on the one page whose job is to explain itself.
    const fromValidator = vExclusionReason.members.map((m) => m.value).sort();
    expect(ALL.slice().sort()).toEqual(fromValidator);
  });

  it("writes newsroom English, not rule codes", () => {
    // Each entry is a clause that gets joined into one sentence, so it stays
    // lowercase and carries no trailing stop of its own.
    for (const text of Object.values(EXCLUSION_REASON_TEXT)) {
      expect(text).not.toMatch(/_/);
      expect(text).not.toMatch(/[.]$/);
      expect(text[0]).toEqual(text[0].toLowerCase());
    }
  });

  it("names the failed rule in one sentence", () => {
    expect(exclusionSentence(["insufficient_independence"])).toBe(
      "Did not qualify: only one kind of source confirmed it, and two are required.",
    );
  });

  it("joins several reasons rather than showing only the first", () => {
    const sentence = exclusionSentence(["insufficient_independence", "stale"]);
    expect(sentence).toContain("only one kind of source");
    expect(sentence).toContain("older than the discovery window");
  });

  it("returns null when nothing was excluded", () => {
    expect(exclusionSentence([])).toBeNull();
    expect(exclusionSentence(undefined)).toBeNull();
  });

  it("ignores a reason it does not recognise rather than printing a code", () => {
    expect(exclusionSentence(["something_new"])).toBeNull();
  });

  it("has a short form for every reason, and only those reasons", () => {
    expect(Object.keys(EXCLUSION_REASON_SHORT).sort()).toEqual(ALL.slice().sort());
  });

  it("keeps the short form short enough to be a chip", () => {
    for (const text of Object.values(EXCLUSION_REASON_SHORT)) {
      expect(text.length).toBeLessThanOrEqual(20);
      expect(text).not.toMatch(/_/);
      expect(text[0]).toEqual(text[0].toUpperCase());
    }
  });

  it("pairs each chip with the full sentence it stands for", () => {
    const chips = exclusionChips(["insufficient_independence", "stale"]);
    expect(chips).toEqual([
      { short: EXCLUSION_REASON_SHORT.insufficient_independence, long: EXCLUSION_REASON_TEXT.insufficient_independence },
      { short: EXCLUSION_REASON_SHORT.stale, long: EXCLUSION_REASON_TEXT.stale },
    ]);
  });

  it("drops unknown codes from chips too", () => {
    expect(exclusionChips(["not_a_real_code"])).toEqual([]);
    expect(exclusionChips(undefined)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { canonicalKey, canonicalizeUrl, contentHash, extractRedditPostId } from "../../../convex/integrations/serpapi/canonical";

describe("canonicalizeUrl", () => {
  it("lowercases the host, drops www and the fragment", () => {
    expect(canonicalizeUrl("https://WWW.JSOnline.com/story/a#top")).toBe("https://jsonline.com/story/a");
  });
  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(canonicalizeUrl("https://x.org/a?utm_source=n&id=7&fbclid=z&gclid=q")).toBe("https://x.org/a?id=7");
  });
  it("sorts remaining query parameters so order cannot create a duplicate", () => {
    expect(canonicalizeUrl("https://x.org/a?b=2&a=1")).toBe(canonicalizeUrl("https://x.org/a?a=1&b=2"));
  });
  it("drops a trailing slash except at the root", () => {
    expect(canonicalizeUrl("https://x.org/a/")).toBe("https://x.org/a");
    expect(canonicalizeUrl("https://x.org/")).toBe("https://x.org/");
  });
  it("returns the input unchanged when it cannot be parsed", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("extractRedditPostId", () => {
  it("reads the post id from an r/milwaukee comments URL", () => {
    expect(extractRedditPostId("https://www.reddit.com/r/milwaukee/comments/1abc23/some_slug/")).toBe("1abc23");
  });
  it("is case-insensitive on the subreddit segment", () => {
    expect(extractRedditPostId("https://reddit.com/r/Milwaukee/comments/1abc23/x")).toBe("1abc23");
  });
  it("rejects another subreddit", () => {
    expect(extractRedditPostId("https://reddit.com/r/wisconsin/comments/1abc23/x")).toBeNull();
  });
  it("rejects a subreddit listing page with no post", () => {
    expect(extractRedditPostId("https://reddit.com/r/milwaukee/")).toBeNull();
  });
  it("rejects a non-reddit URL", () => {
    expect(extractRedditPostId("https://example.com/r/milwaukee/comments/1abc23/x")).toBeNull();
  });
});

describe("contentHash and canonicalKey", () => {
  it("is stable for the same parts and different for changed ones", () => {
    expect(contentHash(["a", "b"])).toBe(contentHash(["a", "b"]));
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["a", "c"]));
  });
  it("prefers the engine-native id when one exists", () => {
    expect(canonicalKey("youtube", "https://youtube.com/watch?v=x", "x")).toBe("youtube:x");
    expect(canonicalKey("google", "https://x.org/a")).toBe("google:https://x.org/a");
  });
});

# 006: The model asks for a search by name, never by web address

## Decision

When SignalGap's AI wants a follow-up search, it may name one search from a fixed, pre-written list and supply a few plain words to drop into it. It may not write a web address, a search query, or any search setting. A separate piece of ordinary code turns an accepted request into the real search, or refuses it and says why.

## Why this came up

SignalGap searches the public web through SerpApi, a paid service that runs Google, Google News, YouTube and other engines on our behalf. Each search costs money and every search is written into a visible log that an editor can read.

That creates two things worth protecting. The first is the **budget**: a scan may spend at most 120 searches, and a model that could compose its own searches could burn through them on anything it found interesting. The second, and the bigger one, is the **log**. SignalGap's whole claim is that a journalist can see exactly what was searched and exactly where every fact came from. If a model can write the search itself, the log becomes a record of the model's improvisation rather than a record of a process anyone agreed to.

There is also a plain security problem. A search query is a small language — it has operators like `site:` that change which part of the web gets looked at. Text a model produces is untrusted input. Letting untrusted input build a query is the same shape of mistake as letting untrusted input build a database command.

## Options

1. **Let the model write the query string.** Most flexible: the model can chase a lead we never anticipated. The cost is that we would be filtering a small language written by an untrusted author, and the visible log would show searches nobody designed. We tried a blocklist of dangerous terms earlier in this project and a reviewer broke it six different ways in one sitting — including with a full-width colon and an invisible zero-width space that both turn back into a plain `site:` once the text is normalised.

2. **Let the model pick a search from a fixed list, and supply plain words for the blanks.** Much less flexible: if the right search is not on the list, the model cannot ask for it, full stop. In exchange, there is no query language to filter — only "is this one of our searches?" and "are these words plain words?" The log shows searches a person wrote, with the model's words dropped into named blanks.

3. **Let the model suggest in prose and have a human write the search.** Safest of all, and unusable at the pace a daily scan needs. It also moves the interesting judgment out of the product.

## What we chose and why

Option 2, chosen by Claude during execution and confirmed by Tarik.

The deciding argument is not that Option 2 is safer in general — it is that Option 2 removes the category of problem instead of defending against it. There is no query language to sanitise, so there is nothing to out-argue. Words are checked against an **allowlist** (letters, numbers, spaces and a short list of ordinary punctuation) rather than a blocklist, because an allowlist cannot be defeated by an operator we failed to imagine.

The refusal path is treated as a feature, not an error. When the model asks for something we do not offer, the request comes back marked rejected with a reason — `unknown_template`, `purpose_mismatch`, `budget_exhausted`. Those refusals are kept and shown. Being able to point at what the AI asked for and was told no is a stronger demonstration of the boundary than any assurance that the boundary exists.

## What we gave up

- **The model cannot express a search we did not anticipate.** This is a real loss, not a technicality. If a Milwaukee story needs an angle our fourteen search templates do not cover, the model has no way to say so except in a rejected request. We will find out about the gap by reading rejections, which is slower than the model simply running the search.
- **Adding a search is a code change.** A new template means writing it, testing it, and shipping it — not typing it into a prompt. That is deliberate friction, and it will feel like friction on the day someone wants a new angle quickly.
- **A rejected request still cost a model call.** We pay to generate a search plan even when every item in it is refused. Measured at roughly seven seconds and a fraction of a cent per plan, this is cheap, but it is not free.
- **The allowlist will reject some legitimate words.** A business name with an unusual character in it gets refused. We would rather widen the allowlist deliberately, with a test, than leave a hole open.

## How we'll know if this was right

Three checkable things:

1. **The visible query log never contains a search a person did not write.** Anyone can open a completed scan, read every search, and find each one in `queryCatalog.ts`. If a search ever appears that is not in that file, this decision failed.
2. **The 120-search cap holds.** Already demonstrated: twenty independent processes racing one scan seeded at 115 were granted exactly five, and the counter landed on 120.
3. **The rejection log stays small and boring.** If a large share of the AI's requests are being refused as `unknown_template`, that is the fixed list being too narrow — a signal to add templates, not a reason to abandon the approach. If almost nothing is refused, the list is doing its job.

## What actually happened

<!-- Tarik fills this in later, in his own words. -->

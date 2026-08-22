# Project Scope: SignalGap

**Status:** Approved scope for PRD development  
**Hackathon target:** SerpApi — Best AI Use Case  
**Initial market:** Milwaukee  
**Available build time:** More than 80 hours before submission

## Project Name Candidates

- **SignalGap** — selected name
- CoverageGap — rejected because it describes only the coverage check, not discovery
- LocalSignal — rejected because it does not communicate the undercoverage problem

## One-Line Summary

SignalGap uses live SerpApi search data and source-traceable AI to find credible Milwaukee developments appearing across multiple public signals but receiving limited verified local coverage, then turns them into transparent reporting briefs for human editors.

## Product Promise

SignalGap helps a small newsroom notice reporting opportunities that are easy to miss when evidence is scattered across search results, public records, news, events, video, maps, trends, community media, and indexed public discussions.

It does not claim to identify every important story, measure community opinion, replace reporters, verify facts autonomously, or publish journalism. It proposes evidence-linked reporting questions for editorial review.

## Target User

### Primary user

A small-newsroom assigning editor who needs to scan multiple beats, distinguish genuine local developments from noise, understand what has already been covered, and decide what to assign or monitor.

### Secondary user

An independent local reporter using the same workflow as a personal assignment desk. The MVP does not create a separate independent-reporter experience.

## Problem

Small newsrooms and independent reporters operate with limited time while potentially useful signals are distributed across unrelated public systems. Conventional news search tends to emphasize stories that have already been published. General social listening can surface conversation without establishing locality, source independence, existing coverage, or factual reliability.

The resulting gap is not simply missing information. It is missing editorial context: why a development surfaced, which evidence is independent, whether local outlets already reported it, what remains unverified, and what a reporter should investigate next.

## Scope Strategy

The MVP is **connector-complete and product-narrow**.

- Connector-complete means each approved source family has one credible, tested route into the system.
- Product-narrow means those sources support one end-to-end editorial loop in one geography and workspace.
- Conditional enrichment limits SerpApi cost: expensive or specialized searches run only for promising candidates.
- The system favors an honest empty feed over weakening its evidence rules to produce more cards.

## Core Workflow

1. The editor signs in through Clerk and enters a single Milwaukee workspace.
2. The editor starts a live scan or opens a previously saved scan.
3. SignalGap queries approved SerpApi source families for the prior seven days.
4. AI normalizes, classifies, connects, and extracts information from the returned results.
5. Deterministic rules deduplicate sources, apply locality and eligibility gates, count existing coverage, calculate component scores, and select candidates for enrichment.
6. SignalGap performs focused follow-up searches for primary evidence, corroboration, and the previous 30 days of local coverage.
7. Eligible candidates appear in a compact ranked feed with visible status, beat, score components, source count, coverage count, and uncertainty labels.
8. The editor opens an expanded evidence view and source-backed reporting brief.
9. The editor rejects, monitors, or assigns the lead. Assignment stores an optional reporter name and note without creating team-management features.
10. Scan history records query use and supports comparison between two scans.

## Discovery Scope

### Geography

- Primary geography: City of Milwaukee
- Secondary geography: Milwaukee County only when a direct city impact is supported
- Google Trends geography: Milwaukee media market, SerpApi `geo=617`, followed by an independent locality check

### Beats

- Housing and neighborhood development
- Transportation and access
- Arts, culture, and neighborhood life

### Time windows

- Discovery: previous seven days
- Existing-coverage check: previous 30 days

### SerpApi source families

The MVP includes:

- Google Trends Trending Now for emerging Milwaukee-area searches
- Google News for beat discovery and existing-coverage checks
- General Google Search with Milwaukee location bias
- Official-domain `site:` searches for city, county, school, meeting, and public-notice records
- Google-indexed `r/milwaukee` posts discovered through idea-shaped query families
- English- and Spanish-language query families
- Google Events for community activity that may indicate a change, conflict, resource, or information need
- YouTube enrichment for relevant public meetings, organizational channels, and community video
- Google Maps enrichment to verify an organization or location and identify possible human sources

The Reddit source represents only content Google has indexed and returned. A Reddit post is labeled **Unverified signal**, can originate a candidate, and never counts as independent corroboration.

## AI Responsibilities

SignalGap uses a hybrid AI architecture. SerpApi supplies live evidence; AI organizes and interprets it; deterministic rules and editors control consequential decisions.

The runtime AI will:

1. Normalize News, Search, Trends, Events, YouTube, and Maps results into one lead structure.
2. Connect semantically related signals that use different language.
3. Extract organizations, streets, neighborhoods, agencies, dates, entities, and factual claims while retaining source URLs.
4. Suggest beat, topic, source type, primary or secondary evidence type, verification state, Milwaukee connection, and probable press-release duplication.
5. Recommend visible, focused SerpApi follow-up searches for official records, previous coverage, and corroboration.
6. Translate and classify Spanish-language results while preserving the original text and source.
7. Draft an evidence-linked reporting brief containing:
   - A proposed reporting question
   - Why the lead surfaced
   - Confirmed facts with direct citations
   - Unverified, disputed, or conflicting claims
   - Existing local coverage
   - Potential human sources
   - Suggested interview questions

AI-generated text is never treated as a source. A statement may appear under **Confirmed facts** only when it has a working source-level citation.

## Deterministic Responsibilities

Code-based rules, not the language model, control:

- Discovery and coverage windows
- Query catalog and source allowlists
- Milwaukee locality requirements
- Source-family deduplication
- Independent-signal threshold
- Existing original-report count
- Component scores and candidate rank
- Brief-promotion threshold
- Citation requirements
- Search-consumption tracking
- Editor disposition and assignment state
- Audit timestamps

AI may suggest classifications that feed these rules, but the evidence, component values, and resulting score remain visible and correctable.

## Candidate and Coverage Rules

A candidate can become a reporting brief only when:

1. It has a clear Milwaukee connection.
2. It concerns a documented change, conflict, decision, service impact, resource, or information need.
3. At least two independent signal categories support the underlying development.
4. A separate search finds no more than two distinct original local reports in the prior 30 days.
5. The sources are accessible and are not merely repeating the same underlying release or claim.
6. The candidate is not purely promotional, speculative, duplicative, or a national trend with a superficial Milwaukee connection.

Coverage checks must explicitly include the approved general, community, Black, Latino, neighborhood, and culturally specific Milwaukee outlets defined in the feasibility design. Qualifying original reporting counts equally regardless of outlet size.

When evidence conflicts, SignalGap preserves both accounts, applies a **Conflicting evidence** label, and blocks disputed material from **Confirmed facts**. It does not choose a preferred account without an explicit evidentiary basis.

## Scoring Scope

Eligible candidates use the approved 100-point transparent scoring model:

- Milwaukee evidence: 25
- Cross-source confirmation: 20
- Freshness and momentum: 15
- Coverage scarcity: 25
- Public-service or beat relevance: 15

The score ranks reporting opportunities; it does not measure social importance or establish truth.

## What We Are Building

### Product foundation

- Clerk authentication
- One user-scoped Milwaukee workspace
- Convex data storage, actions, workflows, scan history, and audit state

### Editorial workflow

- Manual live scan
- Saved, timestamped scan history
- Compact lead feed with beat and disposition filters
- Expanded evidence view
- Transparent score breakdown
- Source-backed reporting brief
- Reject, Monitor, and Assign dispositions
- Optional reporter name and assignment note
- Two-scan comparison for new, persistent, changed, and disappeared leads

### Trust and resilience

- Visible queries and source links
- Confirmed, unverified, and conflicting information separated in the interface
- Community-media coverage pass
- English and Spanish source preservation
- Search-use accounting
- Timestamped saved-scan replay for demo recovery when an external API fails
- Honest empty and partial-result states

### Experience direction

- Notion-like content structure
- Linear-like workflow density and interaction discipline
- Newspaper-style editorial hierarchy inspired by the Los Angeles Times without copying its branding
- Charcoal, warm white, and amber palette
- Accessible dark mode
- Compact feed with an expanded evidence view
- Curious, cautious, and direct product voice
- Approved labels include **Possible development**, **Unverified signal**, **Coverage gap detected**, and **Conflicting evidence**

## What We Are Not Building

The hackathon MVP excludes:

- Multiple newsroom organizations, invitations, permissions, or role administration
- CMS publishing, Slack, email, or push-notification integrations
- Autonomous publication, verification, or reporter assignment
- User-configurable cities or national deployment
- Native mobile applications
- Billing, subscriptions, or usage plans
- A permanent archive of the web or Reddit
- Reddit comment ingestion, sentiment analysis, or claims about community opinion
- A built-in blind-review research console; editorial evaluation may use exported scorecards
- Advanced analytics beyond Milwaukee feasibility and API-use measures
- Exhaustive crawling of any platform or source

## Future Direction: Discussion Signals

A post-MVP research track may add Reddit comment ingestion through an explicitly approved Reddit access route. It would extract questions, first-person accounts, checkable claims, and issue-specific stances while showing sample size, dates, source links, uncertainty, and retention limits.

It would be labeled **Discussion signals**, not public opinion. It requires separate platform approval, privacy controls, model-processing disclosure, deletion handling, dialect-bias evaluation, and human review. It is not required for the hackathon demonstration.

## Inspiration And References

- NewsWhip: early discovery of emerging conversations
- Google Pinpoint: traceable source analysis
- Notion: structured, readable information
- Linear: compact operational workflow
- Los Angeles Times: editorial hierarchy and contextual presentation
- Approved Milwaukee feasibility design: source representation, evidence rules, scoring, testing thresholds, and SerpApi budget

SignalGap combines NewsWhip-style discovery with Pinpoint-style traceability, but its product loop and coverage-gap methodology are specific to local editorial decision-making.

## Demo Path

1. Sign in and open the Milwaukee workspace.
2. Start a live scan and show SerpApi requests returning structured, current results.
3. Show AI normalizing multiple result formats and clustering related signals into one candidate.
4. Open a candidate that includes at least two independent signal categories.
5. Show the 30-day coverage search, including the community-media pass.
6. Inspect the transparent component score and source-family reasoning.
7. Open the AI-generated reporting brief and trace every confirmed fact to its source.
8. Show an unverified or conflicting claim kept outside confirmed facts.
9. Assign or monitor the lead with an editorial note.
10. If a live dependency fails, replay the last successful scan with its original timestamp clearly visible.

The primary demo example should be a real Milwaukee lead. No result will be fabricated solely to make the demonstration appear successful.

## Success Criteria

The proof of concept is successful when:

- At least three of its top five leads are judged worth editorial follow-up.
- The demonstration traces one real Milwaukee lead from discovery through evidence review and disposition.
- Every confirmed factual assertion has a working source citation.
- No lead is described as a coverage gap when an approved community or culturally specific outlet has already produced qualifying original coverage beyond the allowed threshold.
- Reddit and other discussion sources remain labeled as unverified signals.
- The interface exposes why the lead surfaced, what the AI did, how the deterministic score was calculated, and what remains uncertain.
- External failures produce explicit partial or saved-result states rather than invented data.

## Submission Story

Small newsrooms do not lack information; they lack time to connect distributed public signals and determine which ones deserve reporting. SignalGap demonstrates how SerpApi can serve as a live, structured view of the public web while AI performs the semantic work of connecting evidence, exposing coverage gaps, and drafting a source-backed reporting plan.

The product's central argument is:

> SerpApi gives SignalGap live eyes on the public web. AI connects and interprets the signals. Transparent rules and journalists determine what is credible and worth pursuing.

## Principal Risks

| Risk | Scope response |
| --- | --- |
| Too many connectors produce shallow integrations | Require one tested route per source family and use conditional enrichment |
| Search visibility bias hides community reporting | Run fixed community-media and bilingual coverage passes |
| AI overstates or invents facts | Require source-level citations and separate unverified/conflicting claims |
| Duplicate releases appear independent | Deduplicate by source family and flag probable release repetition |
| Milwaukee media-market results extend beyond the city | Require independent city or documented city-impact evidence |
| Empty results tempt threshold relaxation | Preserve the empty state and never weaken the gate for feed volume |
| Live demo dependency fails | Use a clearly timestamped saved-scan replay without presenting it as live |
| Scope expands into a full newsroom platform | Enforce the explicit exclusions above through the PRD and checklist |

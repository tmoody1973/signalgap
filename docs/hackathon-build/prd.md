# Product Requirements Document: SignalGap

**Status:** Approved product requirements for technical specification  
**Hackathon target:** SerpApi — Best AI Use Case  
**Initial market:** Milwaukee  
**Primary user:** Small-newsroom assigning editor  
**Secondary user:** Independent local reporter using the same workflow

## Product Summary

SignalGap is an editorial lead-discovery workspace for finding Milwaukee developments that leave multiple public web signals but have received limited verified local news coverage. It uses live SerpApi results to assemble the evidence, AI to connect and explain related signals, transparent rules to determine eligibility and rank, and a human editor to decide whether a lead should be rejected, monitored, or assigned.

The product is not a publication system, an autonomous fact-checker, a measure of public opinion, or a promise that every important story will be found. Its purpose is narrower: help an editor move from scattered public signals to a cautious, source-backed reporting question without hiding how the conclusion was reached.

## Product Outcome

After using SignalGap, an editor should be able to answer five questions more quickly:

1. What possible Milwaukee development has surfaced?
2. Why did SignalGap connect these signals?
3. Which claims are confirmed, unverified, conflicting, or no longer verifiable?
4. How much qualifying local reporting already exists?
5. What should a reporter investigate next, and which human sources could help?

The editor remains responsible for every editorial judgment and any reporting that follows.

## Product Principles

### Evidence before confidence

SignalGap must show the evidence behind a lead before asking an editor to trust a score or brief. A factual assertion cannot appear under **Confirmed facts** without a working source-level citation.

### Discovery is not verification

Community discussions, trends, events, videos, maps, and search results may help a development surface. Their presence does not establish that a claim is true. Google-indexed Reddit posts are always labeled **Unverified tip** and never count as independent corroboration.

### Coverage must be checked equitably

A development is not a coverage gap merely because a large or familiar outlet has not covered it. The coverage pass must visibly include general-interest, community, Black, Latino, neighborhood, and culturally specific Milwaukee outlets. Qualifying original reporting counts equally regardless of outlet size.

### Uncertainty remains visible

Conflicting, incomplete, or inaccessible evidence must not be silently removed or summarized into false certainty. The interface distinguishes **Worth a look**, **Unverified tip**, **Conflicting reports**, **Needs a recheck**, and **Coverage gap**.

### Empty is better than misleading

SignalGap does not weaken its Milwaukee, corroboration, or coverage rules to fill the feed. A scan with no eligible leads is a valid result.

### AI assists; rules and editors decide

AI may organize sources, connect related wording, extract claims, recommend searches, translate Spanish-language results, and draft a reporting brief. Visible rules determine thresholds and scores. Editors may correct classifications and make the final disposition.

## Target User

### Primary user: assigning editor

The primary user works in a small newsroom, may oversee several beats, and cannot continuously monitor every public source. The editor needs a fast way to identify possible developments, judge whether the evidence is independent, see what other outlets have reported, and decide whether a lead deserves staff time.

The editor values:

- Traceable sources over unsupported summaries
- A compact view that supports quick triage
- Clear distinctions between discovery signals and verified evidence
- Visibility into community and culturally specific coverage
- The ability to correct the system's classifications
- A reporting brief that accelerates, rather than replaces, editorial work

### Secondary user: independent reporter

An independent local reporter uses the same experience as a personal assignment desk. The MVP does not create a separate persona, permission model, or workflow. For this user, **Assign** may contain the reporter's own name or only an editorial note.

## User Jobs

- Scan current public web signals without visiting each source separately.
- Identify developments supported by more than one independent signal category.
- Determine whether the topic has already received qualifying local coverage.
- Understand why a candidate was included, excluded, or ranked where it was.
- Trace every confirmed claim back to its source.
- Correct AI classifications that affect eligibility or scoring.
- Preserve a lead for monitoring or turn it into a reporting assignment.
- Compare scans to see which developments are new, persistent, changed, or no longer visible.

## Definitions

| Term | Product meaning |
| --- | --- |
| Signal | A public web result that may indicate a change, conflict, decision, service impact, resource, or information need |
| Signal category | A distinct evidence family used to assess independence, such as an official record, original news report, event, video, map record, or community discussion |
| Candidate | A group of related signals being evaluated; it may or may not qualify for the ranked feed |
| Eligible lead | A candidate that passes Milwaukee locality, independence, coverage, accessibility, duplication, and editorial-relevance rules |
| Confirmed fact | A narrowly stated claim supported by a working, qualifying source-level citation |
| Unverified tip | A discovery item that may be useful but does not independently establish a fact |
| Conflicting reports | Two or more sources that cannot presently be reconciled on a material claim |
| Coverage gap | An eligible lead with no more than two distinct qualifying original local reports in the prior 30 days after the approved outlet pass completes |
| Reporting brief | An AI-drafted, source-linked starting point for human reporting, not a publishable article |
| Completed scan | A scan that reached an end state, including a completed scan with named partial failures; a canceled scan is incomplete |

## Core User Journey

### First visit

1. The editor signs in.
2. SignalGap explains its purpose in concise language and identifies the fixed Milwaukee coverage area.
3. The editor sees the three active beats: housing and neighborhood development, transportation and access, and arts, culture, and neighborhood life.
4. The editor sees the evidence standard and the primary action **Run first scan**.
5. The editor starts the scan without needing to configure sources, geography, or thresholds.

### Returning visit

1. The editor lands on the latest completed scan.
2. The page shows the scan timestamp, whether it was complete or partial, and counts for eligible, excluded, monitored, assigned, and rejected leads.
3. Existing dispositions and notes remain attached to their leads.
4. The editor may review the feed, compare scans, or select **Run new scan**.

### Discovery-to-decision journey

1. The editor starts a scan.
2. SignalGap reports progress through **Discovering signals**, **Checking local evidence**, **Reviewing existing coverage**, and **Preparing leads**.
3. Leads whose processing is complete may appear while the broader scan continues, but the feed remains marked incomplete.
4. When the scan ends, the editor reviews the ranked feed and filters it as needed.
5. The editor opens a lead and first sees **Why this surfaced**, showing how distinct signals converged.
6. The editor reviews confirmed facts, unverified signals, conflicting evidence, existing coverage, visible searches, and the score breakdown.
7. The editor opens the reporting brief, checks its citations, and may revise the reporting question or add notes.
8. The editor rejects, monitors, or assigns the lead.
9. On a later scan, the editor compares how the lead and its evidence changed.

## Discovery Coverage Requirements

SignalGap must make the breadth and purpose of live search visible without asking the editor to configure individual connectors.

| SerpApi source family | Required product role and boundary |
| --- | --- |
| Google Trends Trending Now | Surface emerging Milwaukee-area searches; a trend requires a separate Milwaukee locality check and is not verification by itself |
| Google News | Support beat discovery and the distinct 30-day existing-coverage review |
| General Google Search | Find relevant public-web signals with Milwaukee location context and support focused follow-up queries |
| Official-domain searches | Seek city, county, school, meeting, agenda, notice, and other primary public records |
| Google-indexed `r/milwaukee` posts | Originate possible leads through idea-shaped query families; always display **Unverified tip** and never count as corroboration |
| Spanish-language searches | Discover relevant sources in Spanish and preserve original text, AI translation, and source metadata |
| Google Events | Surface public activity that may indicate a change, conflict, resource, service impact, or information need; purely promotional events are excluded |
| YouTube | Enrich leads with relevant public meetings, organizational channels, and community video while retaining channel and video provenance |
| Google Maps | Verify the existence or location of an organization or place and identify possible human sources; a map listing alone does not confirm a broader claim |

Discovery runs across the prior seven days. More specialized corroboration, coverage, YouTube, Events, or Maps searches may run only after a candidate appears promising. The editor does not experience conditional enrichment as hidden evidence: every executed query and its purpose remains visible in the scan log.

## Information Hierarchy

### Compact feed

The compact feed is designed for fast editorial triage. Each lead card shows:

- Proposed reporting question
- Beat
- Primary uncertainty or evidence label
- Overall opportunity score
- Independent source-category count
- Existing original-coverage count
- Discovery time
- Current disposition, if any
- **Open evidence** action

The default order is highest overall opportunity score first. The first view contains the top 25 eligible leads, with additional leads loaded in groups of 25. The interface always shows total eligible, excluded, and still-processing counts.

### Expanded evidence view

The evidence view gives the editor the material needed to challenge the system. It presents:

1. Proposed reporting question and current disposition
2. Overall score and component breakdown
3. **Why this surfaced** convergence sequence
4. **Confirmed facts**
5. **Unverified tips**
6. **Conflicting reports**
7. **Needs a recheck**, when applicable
8. **Existing coverage**
9. Potential human sources
10. Search-query log
11. Reporting brief and version history
12. Lead history, corrections, and disposition changes

Each evidence item includes its title or claim, publisher or source, publication or discovery date when available, source type, evidence classification, original-language text when relevant, and a link to the original source.

## Epics And User Stories

### Epic 1: Orientation And Workspace Entry

#### Story 1.1 — Understand the product before scanning

As an assigning editor, I want to understand what SignalGap does and does not claim so that I can interpret its leads responsibly.

Acceptance criteria:

- A first-time user sees SignalGap described as a lead-discovery and reporting-assistance tool.
- The first-run page names Milwaukee as the fixed geography and displays all three active beats.
- The page states that community discussion is not representative public opinion and that AI output is not source evidence.
- The primary action is **Run first scan**; advanced configuration is not required.
- The user can reach a concise explanation of the evidence labels before starting the scan.

#### Story 1.2 — Resume ongoing editorial work

As a returning editor, I want to land on the latest completed scan so that I can resume work without reconstructing context.

Acceptance criteria:

- The latest completed scan is selected by default.
- Its completion time and complete or partial status are visible before the editor opens a lead.
- Counts for eligible, excluded, monitored, assigned, and rejected leads are visible.
- Prior dispositions, corrections, brief versions, reporter names, and notes persist.
- A clear **Run new scan** action is present.

### Epic 2: Live Scan And Progress

#### Story 2.1 — Start a Milwaukee scan

As an editor, I want to initiate a scan with one action so that I can discover current leads without configuring search infrastructure.

Acceptance criteria:

- Selecting **Run first scan** or **Run new scan** starts the fixed Milwaukee discovery workflow.
- The interface identifies the seven-day discovery window.
- Only one live scan can run in the workspace at a time.
- While a scan is running, another scan action is disabled and explains why.
- The user can continue viewing previously completed scans while the new scan runs.

#### Story 2.2 — Understand scan progress

As an editor, I want to see meaningful progress stages so that I know the system is working and which judgments are complete.

Acceptance criteria:

- The interface shows the four approved stages in order: **Discovering signals**, **Checking local evidence**, **Reviewing existing coverage**, and **Preparing leads**.
- Each stage displays pending, active, completed, or failed status.
- Eligible leads may appear when their own evidence and coverage work is complete.
- Until the full scan reaches an end state, the feed is visibly labeled incomplete.
- Result counts distinguish still-processing items from eligible and excluded items.

#### Story 2.3 — Cancel a scan without misrepresenting it

As an editor, I want to stop a scan while preserving completed work so that an accidental or costly run does not erase useful results.

Acceptance criteria:

- The editor can cancel an active scan after a confirmation prompt.
- Completed results remain inspectable.
- The scan receives the label **Stopped early**.
- A canceled scan is not eligible for the standard two-scan comparison.
- Any visible leads from the canceled scan retain an incomplete-scan warning.

#### Story 2.4 — See how live search was used

As an editor, I want a visible query log so that I can audit the role SerpApi played in discovery and verification.

Acceptance criteria:

- Every executed search lists the query text, source family, execution time, result count, and purpose.
- Purpose is one of discovery, corroboration, coverage, or enrichment.
- The log distinguishes successful, empty, and failed searches.
- The interface exposes search-consumption totals for the scan.
- API keys, tokens, and private credentials never appear.

### Epic 3: Ranked Lead Feed

#### Story 3.1 — Triage eligible leads

As an editor, I want a compact ranked feed so that I can decide quickly which developments deserve closer review.

Acceptance criteria:

- Only eligible leads appear in the primary ranked feed.
- Leads are ordered by the approved 100-point opportunity score by default.
- Every card contains all fields defined in the compact-feed information hierarchy.
- The evidence label is visually distinct from the numerical score.
- Selecting **Open evidence** opens the matching lead without losing the feed's current scroll position or filters.

#### Story 3.2 — Filter the feed without losing context

As an editor, I want to filter leads by editorially meaningful attributes so that I can focus on a beat or workflow state.

Acceptance criteria:

- Filters are available for beat, disposition, evidence label, and scan-change status.
- Scan-change status offers **New**, **Changed**, **Persistent**, and **Disappeared** where a comparison exists.
- Multiple compatible filters can be applied together.
- Active filters persist while moving between feed and evidence views.
- Filters reset at the next sign-in.
- A zero-result filtered view explains that the scan may still contain leads outside the selected filters and offers **Clear filters**.

#### Story 3.3 — Navigate a high-volume result set

As an editor, I want SignalGap to remain scannable when many leads qualify so that the most promising items stay visible.

Acceptance criteria:

- The initial feed shows the 25 highest-ranked eligible leads.
- The editor can load the next 25 without changing the eligibility rules or sort order.
- Total eligible, excluded, and processing counts remain visible.
- Loading more results does not reset filters, scroll position, or existing dispositions.
- The interface never describes the top 25 as the only qualifying leads when more exist.

#### Story 3.4 — Understand an honest empty feed

As an editor, I want useful context when no leads qualify so that I can distinguish a valid empty result from a broken scan.

Acceptance criteria:

- The empty state states that no candidates met the current evidence standard.
- It shows the number of signals reviewed, completed source families, and common exclusion reasons.
- It links to the query log and **Review exclusions**.
- It offers **Run new scan**.
- It does not offer a lower threshold or imply that leads were found when they were not.

### Epic 4: Evidence, Citations, And Coverage

#### Story 4.1 — See why a lead surfaced

As an editor, I want to see how separate signals converged so that I can judge whether the lead is more than a coincidental keyword match.

Acceptance criteria:

- The evidence view begins with **Why this surfaced** before presenting the full brief.
- The sequence shows at least two distinct signal categories for an eligible lead.
- Each step identifies its source family, date, and contribution to the candidate.
- Unverified sources are labeled within the sequence and are not presented as corroboration.
- The sequence can show that differently worded results were connected by AI without presenting that connection as a confirmed fact.

#### Story 4.2 — Separate confirmed and uncertain material

As an editor, I want evidence divided by verification state so that uncertainty is not buried inside a fluent summary.

Acceptance criteria:

- **Confirmed facts**, **Unverified tips**, **Conflicting reports**, and **Existing coverage** are separate sections.
- **Needs a recheck** appears as a separate section when a previously available source cannot be opened.
- A claim cannot appear under **Confirmed facts** without at least one working qualifying citation.
- A material conflict blocks the disputed claim from **Confirmed facts**.
- Empty evidence sections are either omitted with an explanatory note or shown explicitly as having no items; they are never populated with invented filler.

#### Story 4.3 — Trace a claim to its source

As an editor, I want to select a claim and inspect its support so that I can verify the system's characterization.

Acceptance criteria:

- Selecting a factual claim reveals the supporting source excerpt or result text, source metadata, and the search query that found it.
- The editor can open the original source in a new tab.
- If multiple sources support a claim, each source is listed separately.
- The interface distinguishes one underlying release repeated by multiple pages from independent reporting.
- A broken source link cannot continue to satisfy the working-citation requirement.

#### Story 4.4 — Evaluate existing local coverage fairly

As an editor, I want to see which local outlets were checked and which reports counted so that **Coverage gap** is not based on an incomplete or inequitable media view.

Acceptance criteria:

- The coverage section displays the 30-day coverage window.
- It lists each distinct qualifying original local report that counted toward the threshold.
- Syndicated copies, rewritten releases, and duplicate pages are grouped rather than counted as independent original reports.
- The coverage log identifies the approved general, community, Black, Latino, neighborhood, and culturally specific outlet groups checked.
- Qualifying original reporting from a smaller or culturally specific outlet counts the same as reporting from a larger outlet.
- **Coverage gap** appears only after the required coverage pass succeeds and finds no more than two qualifying original reports.

#### Story 4.5 — Preserve original Spanish-language evidence

As an editor, I want translated Spanish-language material to retain its original wording and source so that bilingual discovery does not erase context or cultural meaning.

Acceptance criteria:

- A Spanish-language result displays its original text and an English translation.
- The original source, publisher, date, and URL remain attached to both views.
- The interface identifies the English text as an AI translation.
- Editors can view the original without the translation replacing it.
- Translation alone does not change a source's verification state or make two sources independent.

#### Story 4.6 — Handle an unavailable source

As an editor, I want the system to identify when source support has disappeared so that a saved brief does not imply current verification.

Acceptance criteria:

- Original source metadata remains visible after the source becomes unavailable.
- Affected claims move to **Needs a recheck** and stop counting as confirmed.
- The lead explains which eligibility or score components changed because of the unavailable source.
- A claim can return to **Confirmed facts** only when the source becomes accessible again or another qualifying source supports it.
- Prior brief versions remain visible with their original timestamp and evidence set, plus the current reverification warning.

### Epic 5: Transparent Scoring And Corrections

#### Story 5.1 — Understand the opportunity score

As an editor, I want to inspect the score components so that I know why one lead ranks above another.

Acceptance criteria:

- The evidence view displays the 100-point score as five visible components: Milwaukee evidence 25, cross-source confirmation 20, freshness and momentum 15, coverage scarcity 25, and public-service or beat relevance 15.
- Each component shows the points awarded and a plain-language reason.
- The product states that the score ranks reporting opportunities and does not establish truth or social importance.
- The overall score equals the visible component total.
- A score change in scan comparison identifies which components changed.

#### Story 5.2 — Correct a system classification

As an editor, I want to correct consequential classifications so that an AI mistake does not remain embedded in eligibility or ranking.

Acceptance criteria:

- The editor can correct beat, Milwaukee connection, source type, evidence classification, and duplicate-source grouping.
- Before saving, the editor sees which eligibility or score fields may change.
- Saving the correction immediately recalculates eligibility and the score.
- The correction appears in lead history with its time and previous value.
- The reporting brief is labeled outdated until regenerated when the correction changes its evidence set or interpretation.

#### Story 5.3 — Inspect excluded candidates

As an editor, I want to review held-back signals so that I can detect a mistaken exclusion without cluttering the primary feed.

Acceptance criteria:

- **Review exclusions** lists candidates held back as duplicate, promotional, weak-locality, insufficiently corroborated, inaccessible, or otherwise ineligible.
- Each excluded candidate shows its specific reason or reasons.
- Excluded candidates do not appear in the ranked lead feed.
- An editor can correct an eligible classification field from the exclusion view.
- When a correction makes the candidate eligible, it enters the ranked feed at its recalculated position and the history records the transition.

#### Story 5.4 — Preserve an assigned lead after eligibility changes

As an editor, I want an assigned lead to remain visible if its evidence later weakens so that newsroom work is not silently deleted.

Acceptance criteria:

- A lead that falls below eligibility leaves the current ranked feed.
- Its saved history, notes, assignment, and brief versions remain accessible.
- If the lead was assigned, it receives **No longer qualifies**.
- The label explains which correction, missing source, conflict, coverage result, or threshold caused the change.
- Restoring eligibility returns the lead to the ranked feed without erasing its editorial history.

### Epic 6: Source-Backed Reporting Brief

#### Story 6.1 — Receive a brief when a lead qualifies

As an editor, I want an initial reporting brief generated automatically so that I can evaluate the reporting opportunity without starting from a blank page.

Acceptance criteria:

- A brief is generated only after the candidate passes the eligibility requirements.
- The brief contains a proposed reporting question, why the lead surfaced, confirmed facts with citations, unverified or conflicting claims, existing coverage, potential human sources, and suggested interview questions.
- Every confirmed fact links to the matching evidence item.
- The brief identifies itself as AI-generated editorial assistance, not a publishable story.
- If the eligible evidence does not support a section, that section states that no supported material was found rather than inventing content.

#### Story 6.2 — Refine the reporting direction

As an editor, I want to revise the proposed question and add my own notes so that the brief reflects newsroom judgment.

Acceptance criteria:

- The proposed reporting question is editable.
- Editor notes are stored separately from AI-generated text.
- Editor notes are visibly attributed to the editor and are never treated as source evidence.
- Regenerating the brief does not overwrite the proposed question unless the editor explicitly requests a new proposal.
- Regenerating never overwrites editor notes.

#### Story 6.3 — Regenerate after evidence changes

As an editor, I want a new brief after including, excluding, or reclassifying evidence so that the brief reflects the current record.

Acceptance criteria:

- A material evidence correction marks the current brief **Outdated**.
- The editor can regenerate after reviewing the changed evidence set.
- The newest brief opens by default.
- Previous generated versions remain read-only.
- Every version displays its creation time and the evidence set used.
- The editor can compare the newest version with the immediately preceding version.

### Epic 7: Editorial Disposition And Lead History

#### Story 7.1 — Monitor a lead

As an editor, I want to monitor a lead so that future scans can show whether its evidence or coverage changes.

Acceptance criteria:

- Selecting **Monitor** changes the disposition immediately and records the time.
- The lead remains active in later scan comparisons when a matching candidate is found.
- The editor may add an optional monitoring note.
- Monitoring does not change the evidence score.
- The editor can reverse the disposition.

#### Story 7.2 — Assign a lead

As an editor, I want to assign a lead with lightweight context so that a reporter can begin follow-up without SignalGap becoming a project-management system.

Acceptance criteria:

- Selecting **Assign** opens fields for an optional reporter name and assignment note.
- The assignment can be saved without a reporter name.
- The assigned state, name, note, and time appear in lead history.
- Assignment does not claim that the lead is verified or ready to publish.
- The editor can revise or reverse the assignment.

#### Story 7.3 — Reject a lead with a reason

As an editor, I want to record why a lead was rejected so that repeated scans and later evaluation can distinguish weak leads from overlooked ones.

Acceptance criteria:

- Rejecting requires one reason: duplicate, already covered, weak locality, promotional, insufficient evidence, not editorially relevant, or other.
- Selecting **Other** requires a short note.
- The rejected lead leaves the active default view but remains available through disposition filters and history.
- Rejection does not delete its evidence or query log.
- The editor can reverse the rejection.

#### Story 7.4 — Audit lead changes

As an editor, I want a chronological lead history so that I can reconstruct how the system and newsroom judgment changed over time.

Acceptance criteria:

- History records dispositions, corrections, eligibility transitions, brief generations, source-availability changes, and scan appearances.
- Each entry states what changed and when.
- System-generated and editor-generated changes are visibly distinguishable.
- Reversing a decision adds a new history event instead of erasing the prior one.
- History does not expose credentials or private system prompts.

### Epic 8: Scan History And Comparison

#### Story 8.1 — Open a saved scan

As an editor, I want to revisit a timestamped scan so that I can understand what SignalGap knew at that time.

Acceptance criteria:

- Scan history lists each scan by start time, end status, and lead counts.
- Completed, partial, failed, and canceled states are visually distinct.
- Opening a saved scan displays its original query log and result state.
- A replayed saved scan clearly displays its original timestamp and never labels itself live.
- Editorial dispositions added later remain visible without altering the saved evidence timestamp.

#### Story 8.2 — Compare two completed scans

As an editor, I want to compare any two completed scans so that I can find emerging, persistent, changed, or disappeared developments.

Acceptance criteria:

- The editor can select any two completed scans.
- Canceled scans cannot be selected for the standard comparison.
- A completed scan with partial failures may be selected, but the comparison displays a warning naming those failures.
- Leads are grouped as **New**, **Changed**, **Persistent**, or **Disappeared**.
- A changed lead explains material differences in evidence, coverage count, score components, or verification label.
- A disposition change alone does not cause the lead to be labeled as evidence-changed.

### Epic 9: Resilience, Trust, And Accessible Presentation

#### Story 9.1 — Handle a partial source failure

As an editor, I want usable results preserved when one source family fails so that a temporary dependency problem does not erase the scan or conceal its limitations.

Acceptance criteria:

- Successfully completed source-family results remain available.
- Failed source families and searches are named in the progress view and query log.
- The scan receives a visible **Incomplete scan** status.
- If the coverage pass fails, candidates may display **Worth a look** but cannot display **Coverage gap**.
- The interface does not imply that missing source families returned no evidence.

#### Story 9.2 — Keep discussion sources in their proper role

As an editor, I want Reddit and similar discussions clearly constrained so that online conversation is not mistaken for verification or representative community opinion.

Acceptance criteria:

- Every indexed Reddit result is labeled **Unverified tip** wherever it appears.
- Reddit may originate a candidate but never satisfies an independent corroboration requirement.
- The interface states that results reflect what Google indexed and returned, not a complete subreddit archive.
- SignalGap does not display sentiment, popularity, or community-opinion claims from Reddit comments in the MVP.
- A Reddit source cannot move a claim into **Confirmed facts** by itself.

#### Story 9.3 — Use light and dark modes accessibly

As an editor, I want a readable interface in either theme so that dense evidence can be reviewed without sacrificing clarity.

Acceptance criteria:

- The product supports warm-white light mode and charcoal dark mode with amber used as an accent rather than the sole carrier of meaning.
- Evidence states use text labels in addition to color.
- Keyboard users can reach scan actions, filters, lead cards, evidence items, citations, and dispositions in a logical order.
- The active focus state is visible in both themes.
- Expanded evidence remains readable without requiring horizontal scrolling at common desktop widths.

## Cross-Feature Behavior Rules

### Evidence changes

- Excluding or reclassifying evidence triggers immediate eligibility and score recalculation.
- If the lead remains eligible, it stays in the feed at its new rank.
- If it becomes ineligible, it moves to history or exclusions while preserving assignments and notes.
- A materially affected brief becomes **Outdated** until regenerated.

### Scan completion and labels

- **Coverage gap** requires a successful coverage pass.
- **Worth a look** may be shown while corroboration or coverage work remains incomplete.
- **Conflicting reports** blocks disputed material from confirmed status but does not automatically delete the candidate.
- **Stopped early** and **Incomplete scan** remain visible on all results derived from those scans.

### Filters and navigation

- Feed filters persist during the signed-in session while the editor opens and closes evidence views.
- Opening an external citation does not replace the SignalGap workspace.
- Returning from the evidence view restores feed filters and position.
- Signing in again resets filters but does not reset dispositions, corrections, notes, scan history, or brief versions.

### Human authority

- An editor correction takes precedence over the current AI suggestion until the editor changes it again.
- AI may recommend a new classification but may not silently overwrite an editor correction.
- Dispositions do not alter evidence or scores.
- Scores do not automatically assign, reject, or monitor a lead.

## Edge Cases

| Situation | Required product behavior |
| --- | --- |
| No search results from any source | Show a completed empty state only if searches succeeded; otherwise show failure or partial status with named causes |
| Results exist but no candidate is eligible | Show the honest empty feed, reviewed counts, exclusion reasons, query log, and **Review exclusions** |
| One source family fails | Preserve successful results, label the scan **Incomplete scan**, and name the failure |
| Coverage search fails | Block **Coverage gap**; allow **Worth a look** with an explanation |
| Reddit is the only source | Keep the item excluded as insufficiently corroborated and label it **Unverified tip** |
| Two pages repeat one press release | Group them as one underlying source rather than two independent signals |
| Two sources materially conflict | Preserve both, label **Conflicting reports**, and keep the disputed claim out of confirmed facts |
| A working citation later breaks | Move the affected claim to **Needs a recheck** and recalculate eligibility and score |
| Editor correction removes required corroboration | Remove the lead from the ranked feed, preserve history, and mark an assigned lead **No longer qualifies** |
| Editor filters produce no cards | Explain that no leads match the filters and offer **Clear filters** |
| More than 25 leads qualify | Show the top 25 and load additional leads in groups of 25 without changing rank rules |
| User starts another scan during an active scan | Disable the action and direct the user to the running scan |
| User cancels a scan | Preserve completed work, label all results **Stopped early**, and exclude it from standard comparison |
| User regenerates a brief after adding notes | Preserve editor notes and the prior read-only brief version |
| Spanish result is translated | Show original and translated text together; retain the original source and label the translation |
| A national story mentions Milwaukee superficially | Exclude it for weak locality unless documented direct city impact exists |
| An event is purely promotional | Exclude it unless another signal supports a documented change, conflict, resource, service impact, or information need |
| A smaller community outlet already reported the development | Count the qualifying original report equally and update the coverage determination |
| Saved data is used during a demo outage | Display the original timestamp and saved status; never describe it as a live scan |

## Product Content Requirements

### Required status language

- **Worth a look** — might be a story. Checks are not finished yet.
- **Unverified tip** — points to something, but does not prove it.
- **Coverage gap** — two or fewer local outlets reported this in the last 30 days.
- **Conflicting reports** — sources disagree. Not sorted out yet.
- **Needs a recheck** — a source link broke or changed. Check it again.
- **No longer qualifies** — this lead stopped meeting the rules.
- **Incomplete scan** — some searches failed. Results may be missing.
- **Stopped early** — you stopped this scan before it finished.
- **Outdated** — new evidence came in. Regenerate the brief.
- **Saved copy** — from an earlier scan; may not be current.

### Voice

Product language is curious, cautious, and direct. It should say what the system observed and what remains unknown. It must avoid claims such as “the community believes,” “this story is true,” “no one covered this,” or “this should be published” when the evidence supports only a narrower statement.

Preferred phrasing includes:

- “Three source categories appear to concern the same proposed development.”
- “Two qualifying original reports were found in the prior 30 days.”
- “This Reddit result is an unverified community signal discovered through Google indexing.”
- “The coverage check is incomplete, so a coverage gap cannot yet be determined.”

## What We Are Building

### Must demonstrate end to end

- Authenticated entry into one Milwaukee workspace
- First-run and returning-user states
- Manual live scan with visible progress
- Approved live SerpApi discovery and enrichment source families
- Compact ranked feed and expanded evidence view
- **Why this surfaced** convergence sequence
- Source-level claim citations and visible query log
- Equitable 30-day local-coverage review
- Transparent component score
- AI-generated reporting brief with versioned regeneration
- Editor corrections and recalculated eligibility
- Reject, Monitor, and Assign dispositions
- Scan history and two-scan comparison
- Empty, partial, canceled, conflicting, and saved-scan states
- English and Spanish evidence preservation
- Light and dark presentation modes

### Product priorities

| Priority | Requirement |
| --- | --- |
| P0 | A real Milwaukee lead can move from live discovery through evidence review, reporting brief, and disposition |
| P0 | Every confirmed fact has a working source-level citation |
| P0 | Coverage-gap labeling requires the approved local and community-media pass |
| P0 | Reddit and other community discussions remain visibly unverified and do not count as corroboration |
| P0 | Partial failures and saved data are disclosed rather than hidden |
| P1 | Editors can correct classifications, see recalculated scores, and regenerate an outdated brief |
| P1 | Scan comparison explains new, changed, persistent, and disappeared leads |
| P1 | Spanish-language results retain original text, translation, and source |
| P1 | High-volume and exclusion views remain navigable |

## Non-Goals For The Hackathon MVP

- Multiple newsroom organizations, invitations, roles, or permission administration
- CMS publication, Slack, email, SMS, or push-notification integrations
- Autonomous verification, publication, or assignment decisions
- User-configurable cities, beats, evidence thresholds, or national rollout
- Billing, subscriptions, usage plans, or enterprise administration
- Native mobile applications
- A permanent web or Reddit archive
- Direct Reddit comment ingestion
- Sentiment analysis or claims about representative community opinion
- Advanced newsroom productivity analytics
- A blind-review research console inside the product
- Exhaustive crawling of any source

## What We Would Add With More Time

### Discussion Signals research track

A separately approved future feature could ingest Reddit comments through a permitted access route and extract questions, first-person accounts, checkable claims, and issue-specific stances. It would be labeled **Discussion signals**, disclose sample size and dates, preserve source links, minimize retained user content, support deletion and expiry, evaluate dialect bias, and explicitly avoid treating subreddit participation as representative of Milwaukee residents.

### Newsroom collaboration

- Multiple newsroom workspaces
- Reporter accounts and permissions
- Assignment notifications
- Shared comments and review states
- CMS and planning-tool integrations

### Market expansion

- Configurable cities and counties
- Local outlet catalogs by market
- User-defined beats and query families
- Market-level feasibility and bias audits

### Evaluation and analytics

- Longitudinal precision and recall studies
- Blind editorial-review console
- Lead-to-assignment and assignment-to-publication measures
- Coverage-representation dashboards
- Search-cost optimization across multiple markets

## Success Measures

### Hackathon proof-of-concept success

- At least three of the top five ranked leads are judged worth editorial follow-up by the evaluation process.
- At least one real Milwaukee lead is demonstrated from live discovery through evidence review, reporting brief, and disposition.
- Every confirmed factual assertion shown in the demo has a working source citation.
- No demonstrated Reddit result is presented as corroboration or representative public opinion.
- No lead receives **Coverage gap** when the required coverage pass failed or found more than two qualifying original reports.
- The demo exposes at least one AI contribution, one deterministic rule, and one human editorial correction.
- External failure produces an explicit partial or timestamped saved-result state rather than fabricated live data.

### User-experience success

An editor can, without implementation knowledge:

- Explain why a lead surfaced
- Distinguish confirmed, unverified, conflicting, and unavailable evidence
- Open the source for a confirmed claim
- Understand the five score components
- Identify which outlets and searches informed the coverage determination
- Correct a classification and observe the effect
- Produce and disposition a reporting brief

## Submission Proof Points

### SerpApi is indispensable

The demo shows that SignalGap depends on live, structured search data across multiple public-web surfaces. SerpApi is not a decorative search box; it powers initial discovery, official-record follow-up, corroboration, coverage checks, and conditional enrichment.

### AI performs visible semantic work

The demo shows AI normalizing different result formats, connecting differently worded signals, extracting source-linked claims and entities, classifying evidence, translating a Spanish-language result while preserving the original, recommending visible follow-up searches, and drafting the reporting brief.

### Trust is inspectable

The editor can move from a generated statement to its claim, excerpt, source, query, classification, and score effect. Conflicts and missing evidence remain visible.

### The newsroom remains in control

The demo includes an editor correction, deterministic recalculation, brief regeneration, and a final human disposition. SignalGap proposes; the editor decides.

### Cultural representation affects the result

The coverage-gap decision explicitly checks community and culturally specific Milwaukee outlets and counts their qualifying original reporting equally. Bilingual sources retain original language and context.

### Primary demo sequence

1. Sign in and show the latest Milwaukee workspace state.
2. Start a live scan and expose the SerpApi-backed progress and query log.
3. Open a real candidate and reveal **Why this surfaced** across distinct signal categories.
4. Inspect confirmed, unverified, and conflicting material.
5. Show the community-media coverage pass and the transparent score.
6. Open the source-backed reporting brief and trace one confirmed fact to its original source.
7. Correct one classification and show eligibility or score recalculation.
8. Regenerate the outdated brief while preserving the earlier version and editor note.
9. Monitor or assign the lead.
10. Show how a later scan classifies it as new, changed, persistent, or disappeared.

If a live dependency fails, the demonstration switches to a clearly timestamped saved scan and states that it is saved evidence rather than live data.

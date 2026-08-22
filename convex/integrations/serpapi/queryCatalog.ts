import { BEATS, type Beat } from "../../config/beats";
import { COVERAGE_OUTLETS } from "../../config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../config/officialDomains";
import { DISCOVERY_WINDOW_MS } from "../../config/ruleset";
import type { SearchLanguage, SearchPurpose, SerpEngine, TimeWindow } from "./contracts";

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const siteDisjunction = (domains: readonly string[]) => `(${domains.map((d) => `site:${d}`).join(" OR ")})`;
const orTerms = (terms: readonly string[]) => `(${terms.join(" OR ")})`;
const quoted = (terms: readonly string[]) => terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");

export type QueryTemplate = {
  id: string;
  engine: SerpEngine;
  language: SearchLanguage;
  timeWindow: TimeWindow;
  purposes: SearchPurpose[];
  requiresTerms: boolean;
  maxWindowForPurpose: Partial<Record<SearchPurpose, TimeWindow>>;
  build: (args: { now: number; terms: string[] }) => string;
};

const BEAT_TERMS_ES: Record<Beat, string[]> = {
  housing: ["vivienda", "zonificación", "desarrollo", "vecindario", "desalojo"],
  transportation: ["transporte", "autobús", "calle", "bicicleta", "acceso", "construcción"],
  culture: ["arte", "cultura", "festival", "biblioteca", "museo", "restaurante"],
};

const REDDIT_TERMS: Record<Beat, string[]> = {
  housing: ["development", "zoning", "apartment", "demolished", "opening", "closing", '"what happened"'],
  transportation: ["transit", "bus", "traffic", "street", "bike", "access", '"does anyone know"', '"why is"'],
  culture: ["festival", "show", "restaurant", "bar", "venue", '"coming soon"', "shoutout", "rant"],
};

const EVENT_TERMS: Record<Beat, string[]> = {
  housing: ["housing", "neighborhood", "planning", "zoning", "development"],
  transportation: ["transit", "transportation", "street", "access", "public meeting"],
  culture: ["arts", "cultural", "venue", "library", "museum", "neighborhood"],
};

const beats = Object.keys(BEATS) as Beat[];
const discovery: SearchPurpose[] = ["discovery"];

const templates: QueryTemplate[] = [
  {
    id: "trend-milwaukee-01",
    engine: "google_trends_trending_now",
    language: "en",
    timeWindow: "current",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    // ponytail: Trending Now takes a supported geography, not our conceptual
    // location string. The adapter maps this to the Wisconsin geo parameter.
    build: () => "US-WI",
  },
  ...beats.map<QueryTemplate>((beat) => ({
    id: `news-${beat === "transportation" ? "transport" : beat}-en-01`,
    engine: "google_news",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(BEATS[beat].terms)}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `reddit-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: ({ now }) =>
      `site:reddit.com/r/milwaukee/comments/ ${orTerms(REDDIT_TERMS[beat])} after:${isoDate(now - DISCOVERY_WINDOW_MS)}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `search-${beat === "transportation" ? "transport" : beat}-es-01`,
    engine: "google",
    language: "es",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(BEAT_TERMS_ES[beat])}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `events-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google_events",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(EVENT_TERMS[beat])}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `official-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `${siteDisjunction(OFFICIAL_DOMAINS)} ${orTerms(BEATS[beat].terms)}`,
  })),
  {
    id: "coverage-general-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["coverage"],
    requiresTerms: true,
    maxWindowForPurpose: { coverage: "30d" },
    build: ({ terms }) => `${siteDisjunction(COVERAGE_OUTLETS.general.map((o) => o.domain))} ${quoted(terms)}`,
  },
  {
    id: "coverage-community-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["coverage"],
    requiresTerms: true,
    maxWindowForPurpose: { coverage: "30d" },
    build: ({ terms }) => `${siteDisjunction(COVERAGE_OUTLETS.community.map((o) => o.domain))} ${quoted(terms)}`,
  },
  {
    id: "corroborate-entity-01",
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: ["corroboration"],
    requiresTerms: true,
    maxWindowForPurpose: { corroboration: "7d" },
    build: ({ terms }) => `Milwaukee ${quoted(terms)}`,
  },
  {
    id: "official-record-entity-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["corroboration"],
    requiresTerms: true,
    maxWindowForPurpose: { corroboration: "30d" },
    build: ({ terms }) => `${siteDisjunction(OFFICIAL_DOMAINS)} ${quoted(terms)}`,
  },
];

export const DISCOVERY_TEMPLATE_IDS = [
  "trend-milwaukee-01",
  "news-housing-en-01", "news-transport-en-01", "news-culture-en-01",
  "reddit-housing-01", "reddit-transport-01", "reddit-culture-01",
  "search-housing-es-01", "search-transport-es-01", "search-culture-es-01",
  "events-housing-01", "events-transport-01", "events-culture-01",
  "official-housing-01", "official-transport-01", "official-culture-01",
] as const;

export const COVERAGE_TEMPLATE_IDS = ["coverage-general-01", "coverage-community-01"] as const;

export const SUPPLEMENTAL_TEMPLATE_IDS = ["corroborate-entity-01", "official-record-entity-01"] as const;

// Frozen union of every id a model may ask for — `getTemplate` still takes a plain
// `string` at the boundary since a model-supplied id is untrusted input; the byId
// lookup itself is the narrowing (a hit can only be one of these ids).
export type TemplateId =
  | (typeof DISCOVERY_TEMPLATE_IDS)[number]
  | (typeof COVERAGE_TEMPLATE_IDS)[number]
  | (typeof SUPPLEMENTAL_TEMPLATE_IDS)[number];

const byId = new Map(templates.map((t) => [t.id, t]));
export const getTemplate = (id: string): QueryTemplate | undefined => byId.get(id);
export const renderQuery = (t: QueryTemplate, args: { now: number; terms: string[] }) => t.build(args);

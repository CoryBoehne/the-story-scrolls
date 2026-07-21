"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FittedTitle } from "./fitted-title";
import { PlatformFooter, PlatformHeader } from "./site-shell";
import { type LibraryStory, unwrapLibraryPayload } from "./story-types";

type CommunityStory = LibraryStory & {
  creatorName: string | null;
  transformation: string;
  targetAge: number | null;
  ageBand: string | null;
  language: string | null;
  readingDepth: string | null;
  format: string | null;
  illustrationRichness: string | null;
  qualityProfile: string | null;
  sourceTitle: string | null;
  originalAuthor: string | null;
};

type CatalogResponse = {
  stories: CommunityStory[];
  total: number;
  page: number;
  pageCount: number;
};

const FILTERS = {
  ageBand: [["", "Any age"], ["toddler", "Ages 0–4"], ["early-reader", "Ages 5–7"], ["middle-grade-younger", "Ages 8–10"], ["middle-grade-older", "Ages 11–13"], ["young-adult", "Ages 14–17"], ["adult", "Adult"], ["general", "General audience"]],
  language: [["", "Any language"], ["english", "English"], ["spanish", "Spanish"], ["french", "French"], ["german", "German"], ["portuguese", "Portuguese"], ["japanese", "Japanese"]],
  readingDepth: [["", "Any depth"], ["brief", "Quick digest"], ["balanced", "Balanced retelling"], ["detailed", "Detailed retelling"], ["faithful", "Full reading"]],
  format: [["", "Any format"], ["picture_book", "Picture book"], ["prose", "Prose"]],
  illustrationRichness: [["", "Any amount of art"], ["light", "Essential art"], ["balanced", "Richly illustrated"], ["rich", "Lavish art"]],
  transformation: [["", "Any interpretation"], ["faithful", "Faithful"], ["summary", "Summary"], ["translation", "Translation"], ["modernization", "Modernized"], ["reimagination", "Reimagined or new ending"]],
  quality: [["", "Any craft level"], ["sketch", "Sketch"], ["storybook", "Storybook"], ["crafted", "Crafted"], ["heirloom", "Heirloom"], ["masterwork", "Masterwork"], ["custom", "Custom"]],
} as const;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rawItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record.stories)
      ? record.stories
      : Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.community)
          ? record.community
          : [];
  return values.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function transformationKind(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const transformation = value as Record<string, unknown>;
  const reimagination = transformation.reimagination && typeof transformation.reimagination === "object"
    ? transformation.reimagination as Record<string, unknown>
    : {};
  if (reimagination.enabled === true) return "reimagination";
  if (text(transformation.targetLanguage)) return "translation";
  if (text(transformation.modernization) && transformation.modernization !== "none") return "modernization";
  return transformation.mode === "summary" ? "summary" : "faithful";
}

function communityPayload(payload: unknown): CatalogResponse {
  const base = unwrapLibraryPayload(payload);
  const rawBySlug = new Map(rawItems(payload).map((item) => [text(item.slug), item]));
  const stories = base.map((story): CommunityStory => {
    const raw = rawBySlug.get(story.slug) ?? {};
    const facets = raw.facets && typeof raw.facets === "object" ? raw.facets as Record<string, unknown> : {};
    const source = raw.source && typeof raw.source === "object" ? raw.source as Record<string, unknown> : {};
    const adaptation = story.adaptation;
    const transformation = text(raw.transformation) ?? transformationKind(raw.transformation) ?? text(raw.transformationType) ?? text(facets.transformation)
      ?? (adaptation?.transformation.mode === "summary" ? "summary" : "faithful");
    const illustrationCount = number(raw.illustrationCount) ?? 0;
    return {
      ...story,
      creatorName: text(raw.creatorName) ?? text(raw.authorName) ?? story.author ?? null,
      transformation,
      targetAge: number(raw.targetAge) ?? number(facets.targetAge) ?? adaptation?.audience.targetAge ?? null,
      ageBand: text(raw.ageBand) ?? text(facets.ageBand),
      language: text(raw.language) ?? text(raw.languageCode) ?? text(raw.targetLanguage) ?? text(facets.language),
      readingDepth: text(raw.readingDepth) ?? text(facets.readingDepth),
      format: text(raw.format) ?? text(raw.contentFormat) ?? text(facets.format) ?? adaptation?.audience.format ?? null,
      illustrationRichness: text(raw.illustrationRichness) ?? text(facets.illustrationRichness)
        ?? (illustrationCount >= 16 ? "rich" : illustrationCount >= 6 ? "balanced" : illustrationCount > 0 ? "light" : null),
      qualityProfile: text(raw.qualityProfile) ?? text(facets.qualityProfile),
      sourceTitle: text(raw.sourceTitle) ?? text(source.title),
      originalAuthor: text(raw.originalAuthor) ?? text(source.originalAuthor),
    };
  });
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const total = number(record.total) ?? stories.length;
  const page = number(record.page) ?? 1;
  const pageCount = number(record.totalPages) ?? number(record.pageCount) ?? number(record.pages) ?? Math.max(1, Math.ceil(total / 24));
  return { stories, total, page, pageCount };
}

export function CommunityLibrary() {
  const [stories, setStories] = useState<CommunityStory[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [language, setLanguage] = useState("");
  const [readingDepth, setReadingDepth] = useState("");
  const [format, setFormat] = useState("");
  const [illustrationRichness, setIllustrationRichness] = useState("");
  const [transformation, setTransformation] = useState("");
  const [quality, setQuality] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const invalidateCatalogRequest = useCallback(() => {
    requestSequence.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setStatus("loading");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = query.trim();
      if (nextQuery === debouncedQuery) return;
      setStatus("loading");
      setDebouncedQuery(nextQuery);
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [debouncedQuery, query]);

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const requestId = ++requestSequence.current;
    const parameters = new URLSearchParams({ page: String(page), limit: "24" });
    if (debouncedQuery) parameters.set("query", debouncedQuery);
    if (ageBand) parameters.set("ageBand", ageBand);
    if (language) parameters.set("language", language);
    if (readingDepth) parameters.set("readingDepth", readingDepth);
    if (format) parameters.set("format", format);
    if (illustrationRichness) parameters.set("illustrationRichness", illustrationRichness);
    if (transformation) parameters.set("transformation", transformation);
    if (quality) parameters.set("quality", quality);
    void fetch(`/api/v2/community?${parameters.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        const catalog = communityPayload(payload);
        setStories(catalog.stories);
        setTotal(catalog.total);
        setPageCount(catalog.pageCount);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => {
      controller.abort();
      if (activeRequest.current === controller) activeRequest.current = null;
    };
  }, [ageBand, debouncedQuery, format, illustrationRichness, language, page, quality, readingDepth, reloadTick, transformation]);

  const filtersActive = Boolean(debouncedQuery || ageBand || language || readingDepth || format || illustrationRichness || transformation || quality);
  const updateQuery = (nextQuery: string) => {
    const returningToCommittedQuery = nextQuery.trim() === debouncedQuery && query.trim() !== debouncedQuery;
    if (nextQuery.trim() !== debouncedQuery || returningToCommittedQuery) {
      invalidateCatalogRequest();
    }
    if (returningToCommittedQuery) setReloadTick((value) => value + 1);
    setQuery(nextQuery);
  };
  const resetFilters = () => {
    invalidateCatalogRequest();
    setQuery("");
    setDebouncedQuery("");
    setAgeBand("");
    setLanguage("");
    setReadingDepth("");
    setFormat("");
    setIllustrationRichness("");
    setTransformation("");
    setQuality("");
    setPage(1);
    setReloadTick((value) => value + 1);
  };

  return (
    <main className="ss-platform ss-community-page">
      <PlatformHeader />
      <section className="ss-community-hero">
        <div><p className="ss-kicker">Community library</p><h1>Find the version that welcomes you in.</h1><p>Explore approved public scrolls by story, reader, language, depth, format, art, or interpretation—then choose the reading path that feels right today.</p></div>
        <Link className="ss-button ss-button--gold" href="/create/">Create a scroll</Link>
      </section>

      <section className="ss-community-catalog" aria-labelledby="community-heading">
        <div className="ss-community-catalog__toolbar">
          <div><p className="ss-kicker">Public and reviewed</p><h2 id="community-heading">The shared shelf</h2><small>{status === "ready" ? `${total} ${total === 1 ? "scroll" : "scrolls"}` : "Opening the shelf…"}</small></div>
          <label className="ss-library-search"><span className="sr-only">Search community stories</span><input type="search" value={query} onChange={(event) => updateQuery(event.currentTarget.value)} placeholder="Title, author, source, or creator…" /></label>
        </div>

        <div className="ss-community-filters" aria-label="Filter approved public scrolls">
          <Filter label="Reader" value={ageBand} setValue={(value) => { invalidateCatalogRequest(); setAgeBand(value); setPage(1); }} options={FILTERS.ageBand} />
          <Filter label="Language" value={language} setValue={(value) => { invalidateCatalogRequest(); setLanguage(value); setPage(1); }} options={FILTERS.language} />
          <Filter label="Depth" value={readingDepth} setValue={(value) => { invalidateCatalogRequest(); setReadingDepth(value); setPage(1); }} options={FILTERS.readingDepth} />
          <Filter label="Format" value={format} setValue={(value) => { invalidateCatalogRequest(); setFormat(value); setPage(1); }} options={FILTERS.format} />
          <Filter label="Illustrations" value={illustrationRichness} setValue={(value) => { invalidateCatalogRequest(); setIllustrationRichness(value); setPage(1); }} options={FILTERS.illustrationRichness} />
          <Filter label="Interpretation" value={transformation} setValue={(value) => { invalidateCatalogRequest(); setTransformation(value); setPage(1); }} options={FILTERS.transformation} />
          <Filter label="Craft" value={quality} setValue={(value) => { invalidateCatalogRequest(); setQuality(value); setPage(1); }} options={FILTERS.quality} />
          {filtersActive ? <button type="button" onClick={resetFilters}>Clear all</button> : null}
        </div>

        {status === "loading" ? <div className="ss-community-gallery" aria-label="Loading approved public stories">{[0, 1, 2, 3].map((item) => <div className="ss-gallery-card ss-gallery-card--loading" key={item} />)}</div> : null}
        {status === "error" ? <div className="ss-community-empty ss-community-empty--page"><span aria-hidden="true">✦</span><div><h3>The shared shelf is temporarily out of reach.</h3><p>Your filters are still here. Try the request again in a moment.</p><button type="button" onClick={() => { invalidateCatalogRequest(); setReloadTick((value) => value + 1); }}>Try again</button></div></div> : null}
        {status === "ready" && !stories.length ? <div className="ss-community-empty ss-community-empty--page"><span aria-hidden="true">✦</span><div><h3>{filtersActive ? "No approved scroll matches every choice yet." : "The first public scroll is waiting."}</h3><p>{filtersActive ? "Widen a filter, or create the interpretation you hoped to find." : "Begin with a story you wrote or have the right to share."}</p>{filtersActive ? <button type="button" onClick={resetFilters}>Clear all filters</button> : <Link href="/create/">Open the Story Studio</Link>}</div></div> : null}

        {status === "ready" && stories.length ? <div className="ss-community-gallery">{stories.map((story) => <a className="ss-gallery-card" href={`/shared/${encodeURIComponent(story.slug)}/`} data-story-entry data-story-title={story.title} key={story.slug}><div className="ss-gallery-card__art">{story.coverUrl ? <img src={story.coverUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}<span>{story.title.slice(0, 1)}</span></div><div className="ss-gallery-card__body"><p className="ss-gallery-card__label">{communityEditionLabel(story)}</p><FittedTitle as="h3">{story.title}</FittedTitle><p className="ss-gallery-card__author">{story.creatorName ? `Created by ${story.creatorName}` : story.author ? `by ${story.author}` : "Shared by its creator"}</p>{story.description ? <p>{story.description}</p> : null}<div className="ss-gallery-card__facets"><span>{story.readingDepth || "full"}</span><span>{story.format === "picture_book" ? "picture book" : "prose"}</span>{story.language ? <span>{story.language}</span> : null}{story.illustrationRichness ? <span>{story.illustrationRichness} art</span> : null}{story.qualityProfile ? <span>{story.qualityProfile}</span> : null}</div>{story.sourceTitle ? <small>From <em>{story.sourceTitle}</em>{story.originalAuthor ? ` by ${story.originalAuthor}` : ""}</small> : null}{story.contentWarnings?.length ? <small>Notes: {story.contentWarnings.join(", ")}</small> : null}<span>Open scroll →</span></div></a>)}</div> : null}

        {status === "ready" && pageCount > 1 ? <nav className="ss-community-pagination" aria-label="Community catalog pages"><button type="button" disabled={page <= 1} onClick={() => { invalidateCatalogRequest(); setPage((value) => Math.max(1, value - 1)); }}>← Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => { invalidateCatalogRequest(); setPage((value) => Math.min(pageCount, value + 1)); }}>Next →</button></nav> : null}
      </section>

      <section className="ss-community-standards"><p className="ss-kicker">Keep the shelf worth exploring</p><h2>Open-minded, never unguarded.</h2><p>Adventurous, unusual, mature, and challenging stories are welcome. Stolen work, pornography, targeted abuse, illegal material, and content that exploits real people are not. Every public listing receives safety and rights review, and every reader can report a concern; private and unlisted scrolls remain outside this catalog.</p></section>
      <PlatformFooter />
    </main>
  );
}

function Filter({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => setValue(event.currentTarget.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function communityEditionLabel(story: CommunityStory): string {
  const age = story.targetAge ?? story.adaptation?.audience.targetAge;
  if (story.format === "picture_book" || story.adaptation?.audience.format === "picture_book") return age ? `Picture book · age ${age}` : "Picture book";
  if (story.transformation === "summary" || story.adaptation?.transformation.mode === "summary") return age ? `Story digest · age ${age}` : "Story digest";
  if (story.transformation === "translation") return story.language ? `Translation · ${story.language}` : "Translation";
  if (story.transformation === "reimagination") return "Reimagined edition";
  return age ? `Age-adapted · ${age}` : "Community scroll";
}

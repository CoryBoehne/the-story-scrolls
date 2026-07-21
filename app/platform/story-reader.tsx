"use client";

import Link from "next/link";
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { PlatformHeader } from "./site-shell";
import {
  type StoryAsset,
  type StoryBlock,
  type StoryChapter,
  type StoryDocument,
  type StoryParagraphBlock,
  type StoryRun,
  parseStoryAdaptation,
  unwrapStoryPayload,
} from "./story-types";
import { FittedTitle } from "./fitted-title";
import { ImageTextureOverlay } from "./image-texture-overlay";
import { useStoryTransitionArrival } from "./story-transition";

type StoryReaderLoaderProps = {
  sourceUrl: string;
  aiSourceUrl?: string;
  fallbackSlug: string;
  mode: "curated" | "community";
};

type SavedStoryPlace = {
  ratio: number;
  chapterId: string | null;
  updatedAt: number;
};

type StoryFont =
  | "homemade-apple"
  | "caveat-brush"
  | "classic-serif"
  | "literata"
  | "atkinson-hyperlegible"
  | "nunito";
type ReadingLayout = "wide" | "stacked" | "narrow" | "compact";

type AiIllustrationAsset = StoryAsset & {
  type: "ai-illustration";
};

type AiSceneIllustrationPlacement = {
  kind: "after-block";
  chapterId: string;
  afterBlockIndex: number;
  anchorSha256: string;
  assetId: string;
  placement: "inline" | "plate";
  align: "left" | "right" | "plate";
};

type AiChapterHeroPlacement = {
  kind: "chapter-hero";
  chapterId: string;
  chapterSha256: string;
  assetId: string;
};

type AiIllustrationPlacement =
  | AiSceneIllustrationPlacement
  | AiChapterHeroPlacement;

type AiIllustrationManifest = {
  schemaVersion: 1 | 2;
  storySlug: string;
  generation: {
    provider: "OpenAI";
    model: "gpt-image-2";
    quality: "low";
  };
  assets: AiIllustrationAsset[];
  placements: AiIllustrationPlacement[];
};

const ZOOM_MIN = 75;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
const STORY_LOAD_TIMEOUT_MS = 15_000;
const OPTIONAL_ART_TIMEOUT_MS = 4_000;
const TITLE_ARTWORK_TIMEOUT_MS = 6_000;

const STORY_FONTS: Record<StoryFont, { label: string; stack: string }> = {
  "homemade-apple": {
    label: "Homemade Apple",
    stack: '"Homemade Apple", "Bradley Hand", "Segoe Print", Noteworthy, cursive',
  },
  "caveat-brush": {
    label: "Caveat Brush",
    stack: '"Caveat Brush", "Bradley Hand", "Segoe Print", Noteworthy, cursive',
  },
  "classic-serif": {
    label: "Classic book serif",
    stack: 'Iowan Old Style, Baskerville, "Times New Roman", serif',
  },
  literata: {
    label: "Literata",
    stack: '"Literata", Charter, Georgia, serif',
  },
  "atkinson-hyperlegible": {
    label: "Atkinson Hyperlegible",
    stack: '"Atkinson Hyperlegible", Verdana, Arial, sans-serif',
  },
  nunito: {
    label: "Nunito",
    stack: '"Nunito", Avenir, "Segoe UI", sans-serif',
  },
};

function storyFontFrom(value: unknown): StoryFont {
  return typeof value === "string" && value in STORY_FONTS
    ? value as StoryFont
    : "homemade-apple";
}

const READER_PREFERENCES = {
  font: "storyscrolls-story-font",
  contrast: "storyscrolls-high-contrast",
  aiIllustrations: "storyscrolls-ai-illustrations",
  zoom: "storyscrolls-reading-zoom",
  legacyContrast: "storyscrolls:reader-contrast",
  legacyZoom: "storyscrolls:reader-zoom",
};

function normalizeZoom(value: number) {
  if (!Number.isFinite(value)) return 100;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

function readingLayoutFor(viewportWidth: number, zoom: number): ReadingLayout {
  const effectiveWidth = viewportWidth / (normalizeZoom(zoom) / 100);
  if (effectiveWidth <= 560) return "compact";
  if (effectiveWidth <= 680) return "narrow";
  if (effectiveWidth <= 1050) return "stacked";
  return "wide";
}

export function StoryReaderLoader({
  sourceUrl,
  aiSourceUrl,
  fallbackSlug,
  mode,
}: StoryReaderLoaderProps) {
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [aiManifest, setAiManifest] = useState<AiIllustrationManifest | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();
    const artController = new AbortController();
    const timeout = window.setTimeout(() => {
      setStatus("error");
      controller.abort();
    }, STORY_LOAD_TIMEOUT_MS);
    const artTimeout = window.setTimeout(
      () => artController.abort(),
      OPTIONAL_ART_TIMEOUT_MS,
    );

    const storyRequest = fetch(sourceUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Story request failed: ${response.status}`);
      return response.json() as Promise<unknown>;
    });
    const aiRequest = aiSourceUrl
      ? fetch(aiSourceUrl, {
          signal: artController.signal,
          cache: "force-cache",
          headers: { Accept: "application/json" },
        })
          .then((response) => response.ok ? response.json() as Promise<unknown> : null)
          .catch(() => null)
          .finally(() => window.clearTimeout(artTimeout))
      : Promise.resolve(null);

    void Promise.all([storyRequest, aiRequest])
      .then(async ([payload, aiPayload]) => {
        const parsed =
          mode === "community"
            ? normalizeCommunityStory(payload, fallbackSlug)
            : unwrapStoryPayload(payload);
        if (!parsed) throw new Error("The story response was not recognized.");
        const normalizedManifest = await normalizeAiIllustrationManifest(aiPayload, parsed);
        if (controller.signal.aborted) return;
        window.clearTimeout(timeout);
        setStory(parsed);
        setAiManifest(normalizedManifest);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        window.clearTimeout(timeout);
        setStatus("error");
      });

    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(artTimeout);
      controller.abort();
      artController.abort();
    };
  }, [aiSourceUrl, fallbackSlug, mode, sourceUrl]);

  if (status === "loading") return <StoryLoading />;
  if (!story || status === "error") return <StoryUnavailable mode={mode} />;

  return <StoryScroll story={story} mode={mode} aiManifest={aiManifest} />;
}

export function StoryScroll({
  story,
  mode,
  aiManifest,
}: {
  story: StoryDocument;
  mode: "curated" | "community";
  aiManifest: AiIllustrationManifest | null;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const arrivalSpacerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const readingSurfaceRef = useRef<HTMLDivElement>(null);
  const titlePageRef = useRef<HTMLElement>(null);
  const chapterDialogRef = useRef<HTMLDialogElement>(null);
  const chapterTriggerRef = useRef<HTMLButtonElement>(null);
  const chapterSearchRef = useRef<HTMLInputElement>(null);
  const reflowFrameRef = useRef(0);
  const restoreRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [activeChapter, setActiveChapter] = useState(story.chapters[0]?.id ?? "");
  const [placeRestored, setPlaceRestored] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chapterQuery, setChapterQuery] = useState("");
  const [storyFont, setStoryFont] = useState<StoryFont>(() =>
    storyFontFrom(story.generation?.fontFamily));
  const [zoom, setZoom] = useState(100);
  const [highContrast, setHighContrast] = useState(false);
  const [aiIllustrationsEnabled, setAiIllustrationsEnabled] = useState(true);
  const isPictureBook = story.adaptation?.audience.format === "picture_book";
  const showAiIllustrations = isPictureBook || aiIllustrationsEnabled;
  const assetMap = useMemo(
    () => new Map(story.assets.map((asset) => [asset.id, asset])),
    [story.assets],
  );
  const titleArtwork = useMemo(() => {
    const preferredIds = [story.coverAssetId, ...(story.intro?.frames ?? [])]
      .filter((id): id is string => Boolean(id));
    for (const id of preferredIds) {
      const asset = assetMap.get(id);
      if (asset) return asset;
    }
    return mode === "curated"
      ? story.assets.find((asset) => (
          asset.type === "cover" || asset.type === "illustration" || asset.type === "image"
        )) ?? null
      : null;
  }, [assetMap, mode, story.assets, story.coverAssetId, story.intro?.frames]);
  const [readyTitleArtworkPath, setReadyTitleArtworkPath] = useState<string | null>(null);
  const titleArtworkReady = !titleArtwork || readyTitleArtworkPath === titleArtwork.path;
  useEffect(() => {
    if (!titleArtwork) return;
    let cancelled = false;
    let settled = false;
    const image = new Image();
    const settle = () => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setReadyTitleArtworkPath(titleArtwork.path);
    };
    const timeout = window.setTimeout(settle, TITLE_ARTWORK_TIMEOUT_MS);
    image.decoding = "async";
    image.onload = settle;
    image.onerror = settle;
    image.src = titleArtwork.path;
    if (image.complete) void image.decode().then(settle, settle);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };
  }, [titleArtwork]);
  const transitionArrival = useStoryTransitionArrival({
    ready: titleArtworkReady,
    targetRef: paperRef,
    focusRef: titlePageRef,
    spacerRef: arrivalSpacerRef,
  });
  const [enteredFromLibrary, setEnteredFromLibrary] = useState(transitionArrival);
  useEffect(() => {
    if (!transitionArrival) return;
    const frame = window.requestAnimationFrame(() => setEnteredFromLibrary(true));
    return () => window.cancelAnimationFrame(frame);
  }, [transitionArrival]);

  const storageKey = `storyscrolls:story-place:${story.slug}`;
  const hasAiIllustrations = Boolean(
    aiManifest?.assets.length || story.assets.some((asset) => asset.type === "ai-illustration"),
  );
  const aiArtByChapter = useMemo(() => {
    const result = new Map<string, {
      hero?: AiIllustrationAsset;
      scenes: Array<{
        asset: AiIllustrationAsset;
        afterBlockIndex: number;
        alignment: "left" | "right" | "plate";
      }>;
    }>();
    if (!aiManifest) return result;
    const aiAssets = new Map(aiManifest.assets.map((asset) => [asset.id, asset]));
    for (const placement of aiManifest.placements) {
      const asset = aiAssets.get(placement.assetId);
      if (!asset) continue;
      const chapterArt = result.get(placement.chapterId) ?? { scenes: [] };
      if (placement.kind === "chapter-hero") {
        chapterArt.hero = asset;
        result.set(placement.chapterId, chapterArt);
        continue;
      }
      chapterArt.scenes.push({
        asset,
        afterBlockIndex: placement.afterBlockIndex,
        alignment: placement.align,
      });
      result.set(placement.chapterId, chapterArt);
    }
    for (const chapterArt of result.values()) {
      chapterArt.scenes.sort((left, right) => left.afterBlockIndex - right.afterBlockIndex);
    }
    return result;
  }, [aiManifest]);
  const visibleChapters = useMemo(() => {
    const query = chapterQuery.trim().toLocaleLowerCase();
    if (!query) return story.chapters;
    return story.chapters.filter((chapter, index) =>
      `${chapter.label ?? chapter.number ?? padChapter(index + 1)} ${chapter.title}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [chapterQuery, story.chapters]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const savedFont = window.localStorage.getItem(READER_PREFERENCES.font);
        if (savedFont && savedFont in STORY_FONTS) {
          setStoryFont(storyFontFrom(savedFont));
        }

        const sharedZoom = window.localStorage.getItem(READER_PREFERENCES.zoom);
        const legacyZoom = window.localStorage.getItem(READER_PREFERENCES.legacyZoom);
        const savedZoom = normalizeZoom(Number(sharedZoom ?? legacyZoom ?? 100));
        setZoom(savedZoom);
        if (sharedZoom === null && legacyZoom !== null) {
          window.localStorage.setItem(READER_PREFERENCES.zoom, String(savedZoom));
        }

        const sharedContrast = window.localStorage.getItem(READER_PREFERENCES.contrast);
        const legacyContrast = window.localStorage.getItem(READER_PREFERENCES.legacyContrast);
        const contrastEnabled = sharedContrast === "true" ||
          (sharedContrast === null && legacyContrast === "high");
        setHighContrast(contrastEnabled);
        if (sharedContrast === null && legacyContrast !== null) {
          window.localStorage.setItem(READER_PREFERENCES.contrast, String(contrastEnabled));
        }

        const savedAiIllustrations = window.localStorage.getItem(
          READER_PREFERENCES.aiIllustrations,
        );
        setAiIllustrationsEnabled(savedAiIllustrations !== "false");
      } catch {
        // Reading preferences are optional when storage is unavailable.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (restoreRef.current || transitionArrival || enteredFromLibrary) return;
    let saved: SavedStoryPlace | null = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as
        | SavedStoryPlace
        | null;
    } catch {
      saved = null;
    }

    let secondFrame = 0;
    const restore = () => {
      restoreRef.current = true;
      if (!saved || !Number.isFinite(saved.ratio) || saved.ratio <= 0) return;
      const maximum = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
      window.scrollTo({ top: maximum * Math.min(saved?.ratio ?? 0, 1), behavior: "auto" });
      setPlaceRestored(true);
      window.setTimeout(() => setPlaceRestored(false), 3400);
    };

    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(restore);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [enteredFromLibrary, storageKey, transitionArrival]);

  useEffect(() => {
    if (transitionArrival) return;
    let frame = 0;
    let lastStored = 0;

    const update = () => {
      frame = 0;
      const maximum = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maximum));
      setProgress(Math.round(ratio * 1000) / 10);

      const now = Date.now();
      if (now - lastStored > 700) {
        lastStored = now;
        try {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ ratio, chapterId: activeChapter || null, updatedAt: now }),
          );
        } catch {
          // Progress saving gracefully degrades when storage is unavailable.
        }
      }
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeChapter, storageKey, transitionArrival]);

  useEffect(() => {
    const root = readerRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const chapters = Array.from(root.querySelectorAll<HTMLElement>("[data-story-chapter]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveChapter(visible.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.05] },
    );
    chapters.forEach((chapter) => observer.observe(chapter));
    return () => observer.disconnect();
  }, [story.slug]);

  useEffect(() => {
    const reader = readerRef.current;
    const surface = readingSurfaceRef.current;
    if (!reader || !surface) return;
    let settleTimer = 0;
    let settleFrame = 0;

    const commitViewport = () => {
      settleFrame = window.requestAnimationFrame(() => {
        reader.style.setProperty("--ss-stable-vw", `${window.innerWidth / 100}px`);
        reader.style.setProperty("--ss-stable-vh", `${window.innerHeight / 100}px`);
        reader.style.setProperty(
          "--ss-stable-vmin",
          `${Math.min(window.innerWidth, window.innerHeight) / 100}px`,
        );
        surface.dataset.readingLayout = readingLayoutFor(window.innerWidth, zoom);
      });
    };

    const onResize = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(commitViewport, 180);
    };

    commitViewport();
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(settleTimer);
      if (settleFrame) window.cancelAnimationFrame(settleFrame);
    };
  }, [zoom]);

  const preserveReadingPlace = useCallback((change: () => void) => {
    const viewportAnchor = window.innerHeight * 0.4;
    const chapter = activeChapter ? document.getElementById(activeChapter) : null;
    const candidates = chapter
      ? Array.from(chapter.querySelectorAll<HTMLElement>("[data-reader-anchor]"))
      : [];
    const anchor = candidates.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return bounds.top <= viewportAnchor && bounds.bottom >= viewportAnchor;
    }) ?? candidates.reduce<HTMLElement | null>((nearest, candidate) => {
      if (!nearest) return candidate;
      const candidateDistance = Math.abs(candidate.getBoundingClientRect().top - viewportAnchor);
      const nearestDistance = Math.abs(nearest.getBoundingClientRect().top - viewportAnchor);
      return candidateDistance < nearestDistance ? candidate : nearest;
    }, null) ?? chapter;
    const before = anchor?.getBoundingClientRect();
    const anchorRatio = before
      ? Math.min(1, Math.max(0, (viewportAnchor - before.top) / Math.max(before.height, 1)))
      : null;

    change();
    if (!anchor || anchorRatio === null) return;
    if (reflowFrameRef.current) window.cancelAnimationFrame(reflowFrameRef.current);
    reflowFrameRef.current = window.requestAnimationFrame(() => {
      reflowFrameRef.current = window.requestAnimationFrame(() => {
        reflowFrameRef.current = 0;
        if (!anchor.isConnected) return;
        const after = anchor.getBoundingClientRect();
        const anchoredPoint = after.top + after.height * anchorRatio;
        window.scrollBy({ top: anchoredPoint - viewportAnchor, behavior: "auto" });
      });
    });
  }, [activeChapter]);

  const setReaderZoom = useCallback((next: number) => {
    const bounded = normalizeZoom(next);
    if (bounded === zoom) return;
    preserveReadingPlace(() => {
      if (readingSurfaceRef.current) {
        readingSurfaceRef.current.dataset.readingLayout = readingLayoutFor(
          window.innerWidth,
          bounded,
        );
      }
      setZoom(bounded);
      try {
        window.localStorage.setItem(READER_PREFERENCES.zoom, String(bounded));
      } catch {
        // Optional preference.
      }
    });
  }, [preserveReadingPlace, zoom]);

  const changeStoryFont = useCallback((font: StoryFont) => {
    if (font === storyFont) return;
    preserveReadingPlace(() => {
      setStoryFont(font);
      try {
        window.localStorage.setItem(READER_PREFERENCES.font, font);
      } catch {
        // Optional preference.
      }
    });
  }, [preserveReadingPlace, storyFont]);

  const toggleContrast = useCallback(() => {
    setHighContrast((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(READER_PREFERENCES.contrast, String(next));
      } catch {
        // Optional preference.
      }
      return next;
    });
  }, []);

  const toggleAiIllustrations = useCallback(() => {
    preserveReadingPlace(() => {
      setAiIllustrationsEnabled((current) => {
        const next = !current;
        try {
          window.localStorage.setItem(READER_PREFERENCES.aiIllustrations, String(next));
        } catch {
          // Optional preference.
        }
        return next;
      });
    });
  }, [preserveReadingPlace]);

  const closeChapterDrawer = useCallback(() => {
    const dialog = chapterDialogRef.current;
    if (dialog?.open) dialog.close();
    else setDrawerOpen(false);
  }, []);

  const openChapterDrawer = useCallback(() => {
    const dialog = chapterDialogRef.current;
    if (!dialog) return;
    setDrawerOpen(true);
    if (!dialog.open) dialog.showModal();
    window.requestAnimationFrame(() => {
      chapterSearchRef.current?.focus();
      dialog
        .querySelector<HTMLElement>("[aria-current='location']")
        ?.scrollIntoView({ block: "center" });
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (!editing && event.key.toLocaleLowerCase() === "l") {
        event.preventDefault();
        if (chapterDialogRef.current?.open) closeChapterDrawer();
        else openChapterDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeChapterDrawer, openChapterDrawer]);

  useEffect(() => () => {
    if (reflowFrameRef.current) window.cancelAnimationFrame(reflowFrameRef.current);
  }, []);

  const shareStory = useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: story.title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 2200);
    } catch {
      setShareState("idle");
    }
  }, [story.title]);

  const storyStyle = {
    "--ss-story-accent": safeCssColor(story.theme?.accent) ?? defaultAccent(story.slug),
    "--ss-story-font": STORY_FONTS[storyFont].stack,
    "--ss-reading-zoom": String(zoom / 100),
    "--ss-reading-zoom-inverse": String(100 / zoom),
  } as CSSProperties;

  return (
    <main
      ref={readerRef}
      className={`ss-story ss-story--${storyVariant(story)}${
        highContrast ? " ss-story--high-contrast" : ""
      }`}
      data-story-font={storyFont}
      data-reading-zoom={zoom}
      data-ai-illustrations={showAiIllustrations ? "on" : "off"}
      data-story-format={isPictureBook ? "picture_book" : "prose"}
      style={storyStyle}
    >
      <div className="ss-reading-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      <PlatformHeader
        compact
        trailing={
          <div className="ss-reader-tools">
            <button
              ref={chapterTriggerRef}
              className="ss-reader-contents-trigger"
              type="button"
              onClick={openChapterDrawer}
              aria-label="Open chapter contents"
              aria-haspopup="dialog"
              aria-controls="ss-story-chapters"
              aria-expanded={drawerOpen}
              title="Chapters (L)"
            >
              <span aria-hidden="true">☰</span>
              <span>Contents</span>
              <kbd>L</kbd>
            </button>
            <details className="ss-reader-settings">
              <summary aria-label="Reading settings">Aa</summary>
              <div>
                <p className="ss-reader-settings__title">Reading settings</p>
                <fieldset className="ss-reader-settings__fonts">
                  <legend>Story font</legend>
                  <div>
                    {(Object.entries(STORY_FONTS) as Array<
                      [StoryFont, (typeof STORY_FONTS)[StoryFont]]
                    >).map(([value, font]) => (
                      <button
                        type="button"
                        key={value}
                        data-font={value}
                        aria-pressed={storyFont === value}
                        onClick={() => changeStoryFont(value)}
                      >
                        <span aria-hidden="true">Aa</span>
                        <b>{font.label}</b>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="ss-reader-settings__zoom">
                  <div>
                    <span id="ss-reader-zoom-label">Reading size</span>
                    <output aria-live="polite">{zoom}%</output>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setReaderZoom(zoom - ZOOM_STEP)}
                      disabled={zoom <= ZOOM_MIN}
                      aria-label="Decrease reading size"
                    >
                      A−
                    </button>
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={ZOOM_STEP}
                      value={zoom}
                      aria-labelledby="ss-reader-zoom-label"
                      aria-valuetext={`${zoom}%`}
                      onChange={(event) => setReaderZoom(Number(event.target.value))}
                    />
                    <button
                      type="button"
                      onClick={() => setReaderZoom(zoom + ZOOM_STEP)}
                      disabled={zoom >= ZOOM_MAX}
                      aria-label="Increase reading size"
                    >
                      A+
                    </button>
                  </div>
                  <small>Scales the manuscript, illustrations, and illuminated initials together.</small>
                </div>
                {hasAiIllustrations && !isPictureBook ? (
                  <div className="ss-reader-settings__toggle ss-reader-settings__toggle--ai">
                    <span>
                      <b>AI illustrations</b>
                      <small>Adds a panoramic chapter opener and vivid scenes between passages</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiIllustrationsEnabled}
                      aria-label="Show AI-generated story illustrations"
                      onClick={toggleAiIllustrations}
                    >
                      <i aria-hidden="true" />
                      <b>{aiIllustrationsEnabled ? "On" : "Off"}</b>
                    </button>
                  </div>
                ) : null}
                <div className="ss-reader-settings__contrast ss-reader-settings__toggle">
                  <span>
                    <b>High contrast</b>
                    <small>Black, fully opaque story text</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={highContrast}
                    aria-label="Use high-contrast story text"
                    onClick={toggleContrast}
                  >
                    <i aria-hidden="true" />
                    <b>{highContrast ? "On" : "Off"}</b>
                  </button>
                </div>
                <p className="ss-reader-settings__saved">
                  Your place and reading choices stay on this device.
                </p>
              </div>
            </details>
            <button className="ss-reader-share" type="button" onClick={shareStory}>
              {shareState === "copied" ? "Shared" : "Share"}
            </button>
          </div>
        }
      />

      <dialog
        ref={chapterDialogRef}
        id="ss-story-chapters"
        className="ss-story-drawer"
        aria-labelledby="ss-story-drawer-title"
        onClose={() => {
          setDrawerOpen(false);
          chapterTriggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeChapterDrawer();
        }}
      >
        <div className="ss-story-drawer__panel">
          <header>
            <div>
              <p className="ss-kicker">{story.title}</p>
              <h2 id="ss-story-drawer-title">Choose a chapter</h2>
            </div>
            <button type="button" onClick={closeChapterDrawer} aria-label="Close chapter contents">
              ×
            </button>
          </header>
          <label className="ss-story-drawer__search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={chapterSearchRef}
              type="search"
              value={chapterQuery}
              onChange={(event) => setChapterQuery(event.target.value)}
              placeholder="Find a chapter…"
              aria-label="Find a chapter"
            />
          </label>
          <nav aria-label={`${story.title} chapters`}>
            {visibleChapters.map((chapter, index) => {
              const originalIndex = story.chapters.indexOf(chapter);
              const anchor = chapterAnchor(chapter, originalIndex >= 0 ? originalIndex : index);
              const active = activeChapter === anchor;
              return (
                <a
                  href={`#${anchor}`}
                  key={chapter.id || index}
                  aria-current={active ? "location" : undefined}
                  onClick={closeChapterDrawer}
                >
                  <i aria-hidden="true" />
                  <span>
                    <small>{chapter.label ?? chapter.number ?? padChapter(originalIndex + 1)}</small>
                    <strong>{chapter.title}</strong>
                  </span>
                  {active ? <b>Here</b> : null}
                </a>
              );
            })}
            {!visibleChapters.length ? <p>No chapters match that search.</p> : null}
          </nav>
          <footer>{story.chapters.length} chapters · reading progress is saved on this device</footer>
        </div>
      </dialog>

      <div
        ref={arrivalSpacerRef}
        className="ss-story-transition__arrival-spacer"
        aria-hidden="true"
      />
      <div ref={paperRef} className="ss-story-paper">
        <div className="ss-story-manuscript">
          <div
            ref={readingSurfaceRef}
            className="ss-reading-zoom-surface"
            data-reading-layout="wide"
          >
            <StoryTitlePage
              ref={titlePageRef}
              story={story}
              artwork={titleArtwork}
              mode={mode}
            />
            <article id="story-content" className="ss-story-scroll" aria-label={story.title}>
              {story.chapters.map((chapter, index) => (
                <StoryChapterSection
                  key={chapter.id || index}
                  chapter={chapter}
                  index={index}
                  assets={assetMap}
                  chapterHero={
                    showAiIllustrations
                      ? aiArtByChapter.get(chapter.id)?.hero
                      : undefined
                  }
                  aiIllustrations={
                    showAiIllustrations
                      ? aiArtByChapter.get(chapter.id)?.scenes ?? []
                      : []
                  }
                  showAiIllustrations={showAiIllustrations}
                  illuminatedGlyphs={story.theme?.illuminatedGlyphs}
                />
              ))}
            </article>

            <StoryColophon story={story} mode={mode} />
          </div>
        </div>
      </div>

      {placeRestored ? (
        <div className="ss-place-restored" role="status">
          Your place was restored on this device.
        </div>
      ) : null}
    </main>
  );
}

type StoryTitlePageProps = {
  story: StoryDocument;
  artwork: StoryAsset | null;
  mode: "curated" | "community";
};

const StoryTitlePage = forwardRef<HTMLElement, StoryTitlePageProps>(function StoryTitlePage(
  { story, artwork, mode },
  ref,
) {
  const sourceUrl = storySourceUrl(story);
  const firstChapterTarget = story.chapters[0]
    ? chapterAnchor(story.chapters[0], 0)
    : "story-content";

  return (
    <section
      ref={ref}
      className={`ss-story-title-page${mode === "community" ? " ss-story-title-page--community" : ""}`}
      aria-labelledby="story-title"
      tabIndex={-1}
    >
      <div className="ss-story-title-page__heading">
        <p className="ss-kicker">
          {mode === "community" ? "A community scroll" : "A curated Story Scroll"}
        </p>
        <FittedTitle as="h1" id="story-title">{story.title}</FittedTitle>
        {story.subtitle ? <p className="ss-story-title-page__subtitle">{story.subtitle}</p> : null}
        {story.author ? <p className="ss-story-title-page__author">by {story.author}</p> : null}
      </div>

      {artwork ? (
        <StoryIllustration
          asset={artwork}
          alignment="plate"
          variant="title-page"
          priority
        />
      ) : <div className="ss-story-title-page__ornament" aria-hidden="true">✦</div>}

      <div className="ss-story-title-page__credits">
        {story.creatorName && story.creatorName !== story.author ? (
          <span>Scroll created by {story.creatorName}</span>
        ) : null}
        {story.source?.sourceTitle && story.source.sourceTitle !== story.title ? (
          <span>Adapted from {readerFacingSourceText(story.source.sourceTitle)}</span>
        ) : null}
        {story.source?.edition ? <span>Source edition: {readerFacingSourceText(story.source.edition)}</span> : null}
        {story.source?.changeDescription ? (
          <span>Changes: {readerFacingSourceText(story.source.changeDescription)}</span>
        ) : null}
        {adaptationEditionLabel(story) ? <span>{adaptationEditionLabel(story)}</span> : null}
        {adaptationCraftLabel(story) ? <span>{adaptationCraftLabel(story)}</span> : null}
        {adaptationGenerationLabel(story) ? <span>{adaptationGenerationLabel(story)}</span> : null}
        {storyAiIllustratorLabel(story) ? <span>{storyAiIllustratorLabel(story)}</span> : null}
        {storyTypographyLabel(story) ? <span>{storyTypographyLabel(story)}</span> : null}
        {story.illustrator ? <span>Illustrated by {story.illustrator}</span> : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            View source ↗
          </a>
        ) : null}
      </div>
      {story.contentWarnings?.length ? (
        <details className="ss-story-title-page__warnings">
          <summary>Content note</summary>
          <p>{story.contentWarnings.join(" · ")}</p>
        </details>
      ) : null}
      <a className="ss-story-title-page__begin" href={`#${firstChapterTarget}`}>
        Continue to chapter one <span aria-hidden="true">↓</span>
      </a>
    </section>
  );
});

function StoryChapterSection({
  chapter,
  index,
  assets,
  chapterHero,
  aiIllustrations,
  showAiIllustrations,
  illuminatedGlyphs,
}: {
  chapter: StoryChapter;
  index: number;
  assets: Map<string, StoryAsset>;
  chapterHero?: AiIllustrationAsset;
  aiIllustrations: Array<{
    asset: AiIllustrationAsset;
    afterBlockIndex: number;
    alignment: "left" | "right" | "plate";
  }>;
  showAiIllustrations: boolean;
  illuminatedGlyphs?: Record<string, string>;
}) {
  const firstParagraphIndex = chapter.blocks.findIndex(
    (block) => block.type === "paragraph" && block.text.trim(),
  );
  const firstParagraph =
    firstParagraphIndex >= 0
      ? (chapter.blocks[firstParagraphIndex] as StoryParagraphBlock)
      : null;
  const initial =
    chapter.firstLetter?.trim().slice(0, 1) ??
    firstParagraph?.text.trim().slice(0, 1) ??
    "";
  const embeddedHeroBlock = chapter.blocks.find(
    (block) => block.type === "image" && block.placement === "chapter-hero",
  );
  const embeddedHeroAsset = embeddedHeroBlock?.type === "image"
    ? assets.get(embeddedHeroBlock.assetId)
    : undefined;
  const visibleEmbeddedHero =
    embeddedHeroAsset?.type === "ai-illustration" && !showAiIllustrations
      ? undefined
      : embeddedHeroAsset;
  const resolvedChapterHero = chapterHero ?? visibleEmbeddedHero;

  return (
    <section
      id={chapterAnchor(chapter, index)}
      className="ss-story-chapter"
      data-story-chapter
    >
      <header className="ss-story-chapter__heading">
        <p>{chapter.label ?? chapter.number ?? padChapter(index + 1)}</p>
        <FittedTitle as="h2">{chapter.title}</FittedTitle>
      </header>

      {resolvedChapterHero ? (
        <StoryIllustration
          asset={resolvedChapterHero}
          alignment="plate"
          variant="chapter-hero"
        />
      ) : null}

      <div className="ss-story-chapter__body">
        {chapter.blocks.map((block, blockIndex) => (
          <Fragment key={`${chapter.id}-${blockIndex}`}>
            {block.type === "image" && block.placement === "chapter-hero" ? null : (
              <StoryBlockView
                block={block}
                asset={block.type === "image"
                  ? (() => {
                      const asset = assets.get(block.assetId);
                      return asset?.type === "ai-illustration" && !showAiIllustrations
                        ? undefined
                        : asset;
                    })()
                  : undefined}
                initial={blockIndex === firstParagraphIndex ? initial : ""}
                illuminatedGlyphs={illuminatedGlyphs}
              />
            )}
            {aiIllustrations
              .filter((illustration) => illustration.afterBlockIndex === blockIndex)
              .map((illustration) => (
                <StoryIllustration
                  key={illustration.asset.id}
                  asset={illustration.asset}
                  alignment={illustration.alignment}
                />
              ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function StoryBlockView({
  block,
  asset,
  initial,
  illuminatedGlyphs,
}: {
  block: StoryBlock;
  asset?: StoryAsset;
  initial: string;
  illuminatedGlyphs?: Record<string, string>;
}) {
  if (block.type === "image") {
    if (!asset) return null;
    const requestedAlignment = block.align ??
      (block.placement === "plate" || block.placement === "chapter-hero" ? "plate" : "right");
    const alignment = requestedAlignment === "center" || requestedAlignment === "hero"
      ? "plate"
      : requestedAlignment;
    return <StoryIllustration asset={asset} alignment={alignment} readerAnchor />;
  }

  if (block.type === "verse") {
    return (
      <div
        className={`ss-story-verse${block.shape ? ` ss-story-verse--${slugClass(block.shape)}` : ""}`}
        data-reader-anchor
      >
        {block.lines.map((line, index) => (
          <span key={`${line}-${index}`}>{line || "\u00a0"}</span>
        ))}
      </div>
    );
  }

  if (block.type === "ornament") {
    return (
      <div className="ss-story-ornament" data-reader-anchor aria-hidden="true">
        <i />
        <span>{block.mark || "✦"}</span>
        <i />
      </div>
    );
  }

  const runs = block.runs?.length ? block.runs : [{ text: block.text }];
  const contentRuns = initial ? removeOpeningCharacter(runs, initial) : runs;

  return (
    <p
      className={initial ? "ss-story-paragraph ss-story-paragraph--opening" : "ss-story-paragraph"}
      data-reader-anchor
    >
      {initial ? <IlluminatedInitial letter={initial} glyphs={illuminatedGlyphs} /> : null}
      <RunText runs={contentRuns} />
    </p>
  );
}

function RunText({ runs }: { runs: StoryRun[] }) {
  return runs.map((run, index) => {
    let child: ReactNode = run.text;
    if (run.strong) child = <strong>{child}</strong>;
    if (run.emphasis) child = <em>{child}</em>;
    const href = safeWebHref(run.href);
    if (href) {
      child = (
        <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          {child}
        </a>
      );
    }
    return <span key={`${run.text.slice(0, 12)}-${index}`}>{child}</span>;
  });
}

function IlluminatedInitial({
  letter,
  glyphs,
}: {
  letter: string;
  glyphs?: Record<string, string>;
}) {
  const normalized = letter.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return <span className="ss-dropcap-fallback">{letter}</span>;
  const source = glyphs?.[normalized];

  return (
    <span className={`ss-dropcap${source ? "" : " is-fallback"}`} aria-label={letter}>
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
            event.currentTarget.parentElement?.classList.add("is-fallback");
          }}
        />
      ) : null}
      <span>{letter}</span>
    </span>
  );
}

function StoryIllustration({
  asset,
  alignment,
  variant = "scene",
  readerAnchor = false,
  priority = false,
}: {
  asset: StoryAsset;
  alignment: "left" | "right" | "plate";
  variant?: "scene" | "chapter-hero" | "title-page";
  readerAnchor?: boolean;
  priority?: boolean;
}) {
  const isAiGenerated = asset.type === "ai-illustration";
  const isChapterHero = variant === "chapter-hero";
  const isTitlePage = variant === "title-page";
  return (
    <figure
      className={`ss-story-image ss-story-image--${alignment}${isAiGenerated ? " ss-story-image--ai" : ""}${isChapterHero ? " ss-story-image--chapter-hero" : ""}${isTitlePage ? " ss-story-image--title-page" : ""}`}
      data-ai-illustration={isAiGenerated ? "true" : undefined}
      data-ai-illustration-role={isAiGenerated ? variant : undefined}
      data-reader-anchor={readerAnchor ? "true" : undefined}
    >
      <div className="ss-story-image__canvas">
        <span className="ss-story-image__fallback" aria-hidden="true">✦</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.path}
          alt={readerFacingSourceText(asset.alt || asset.caption || "Story illustration")}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          onError={(event) => {
            event.currentTarget.hidden = true;
            event.currentTarget.parentElement?.classList.add("is-fallback");
          }}
        />
        <ImageTextureOverlay source={asset.path} fit={isChapterHero ? "cover" : "contain"} />
      </div>
      {asset.caption || asset.creator || asset.sourceUrl ? (
        <figcaption>
          {asset.caption ? <span>{readerFacingSourceText(asset.caption)}</span> : null}
          <small>
            {isAiGenerated
                ? `AI illustration · ${readerFacingSourceText(asset.creator || "OpenAI GPT Image 2")}`
              : asset.creator
                ? `Illustration by ${readerFacingSourceText(asset.creator)}`
                : "Source illustration"}
            {asset.license ? ` · ${readerFacingSourceText(asset.license)}` : null}
            {asset.sourceUrl ? (
              <>
                {" "}·{" "}
                <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                  original ↗
                </a>
              </>
            ) : null}
          </small>
        </figcaption>
      ) : null}
    </figure>
  );
}

function StoryColophon({
  story,
  mode,
}: {
  story: StoryDocument;
  mode: "curated" | "community";
}) {
  const sourceUrl = storySourceUrl(story);
  const sourceUrls = storySourceUrls(story);
  const rights = storyRightsLabel(story);
  const rightsStatement = storyRightsStatement(story);
  return (
    <footer className="ss-story-colophon">
      <p className="ss-kicker">The scroll continues</p>
      <FittedTitle as="h2">{`You have reached the end of ${story.title}.`}</FittedTitle>
      <p>
        The Story Scrolls keeps the people and sources behind every edition visible.
        This presentation does not replace the canonical source.
      </p>
      <dl>
        {story.creatorName && story.creatorName !== story.author ? (
          <div>
            <dt>Scroll creator</dt>
            <dd>{story.creatorName}</dd>
          </div>
        ) : null}
        {story.author ? (
          <div>
            <dt>{story.source?.originalAuthor ? "Original author" : "Author"}</dt>
            <dd>{story.author}</dd>
          </div>
        ) : null}
        {story.source?.sourceTitle ? (
          <div>
            <dt>Original source</dt>
            <dd>{readerFacingSourceText(story.source.sourceTitle)}</dd>
          </div>
        ) : null}
        {story.source?.edition ? (
          <div>
            <dt>Source edition</dt>
            <dd>{readerFacingSourceText(story.source.edition)}</dd>
          </div>
        ) : null}
        {story.source?.changeDescription ? (
          <div>
            <dt>Changes in this scroll</dt>
            <dd>{readerFacingSourceText(story.source.changeDescription)}</dd>
          </div>
        ) : null}
        {story.illustrator ? (
          <div>
            <dt>Illustrator</dt>
            <dd>{story.illustrator}</dd>
          </div>
        ) : null}
        {adaptationEditionLabel(story) ? (
          <div>
            <dt>Edition</dt>
            <dd>{adaptationEditionLabel(story)}</dd>
          </div>
        ) : null}
        {adaptationCraftLabel(story) ? (
          <div>
            <dt>Craft plan</dt>
            <dd>{adaptationCraftLabel(story)}</dd>
          </div>
        ) : null}
        {adaptationGenerationLabel(story) ? (
          <div>
            <dt>Generation</dt>
            <dd>{adaptationGenerationLabel(story)}</dd>
          </div>
        ) : null}
        {storyAiIllustratorLabel(story) ? (
          <div>
            <dt>Illustrations</dt>
            <dd>{storyAiIllustratorLabel(story)}</dd>
          </div>
        ) : null}
        {storyTypographyLabel(story) ? (
          <div>
            <dt>Reading design</dt>
            <dd>{storyTypographyLabel(story)}</dd>
          </div>
        ) : null}
        {rights ? (
          <div>
            <dt>Rights</dt>
            <dd>{rights}</dd>
          </div>
        ) : null}
        {rightsStatement && rightsStatement !== rights ? (
          <div>
            <dt>Rights statement</dt>
            <dd>{rightsStatement}</dd>
          </div>
        ) : null}
        {sourceUrls.map((url, index) => (
          <div key={url}>
            <dt>{sourceUrls.length === 1 ? "Source" : `Source ${index + 1}`}</dt>
            <dd>
              <a href={url} target="_blank" rel="noreferrer">
                {sourceLinkLabel(url, index, sourceUrls.length)} ↗
              </a>
            </dd>
          </div>
        ))}
      </dl>
      {typeof story.rights?.jurisdictionNote === "string" ? (
        <p className="ss-story-colophon__rights-note">
          {story.rights.jurisdictionNote}
        </p>
      ) : null}
      <div className="ss-story-colophon__actions">
        {sourceUrl ? (
          <a className="ss-button ss-button--quiet" href={sourceUrl} target="_blank" rel="noreferrer">
            Visit the source ↗
          </a>
        ) : null}
        <Link className="ss-button ss-button--gold" href="/">
          Return to the library
        </Link>
      </div>
      {mode === "community" ? <StoryReport slug={story.slug} /> : null}
    </footer>
  );
}

function StoryReport({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setState("sending");
    try {
      const response = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          reason: formData.get("reason"),
          details: String(formData.get("details") ?? "").trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error("Report failed");
      form.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <details className="ss-story-report">
      <summary>Report a rights or safety concern</summary>
      <form onSubmit={submit}>
        <label>
          Concern
          <select name="reason" defaultValue="copyright" required>
            <option value="copyright">Copyright or ownership</option>
            <option value="sexual_content">Sexual content</option>
            <option value="hate_or_harassment">Hate or harassment</option>
            <option value="violence">Graphic violence</option>
            <option value="self_harm">Self-harm</option>
            <option value="illegal">Illegal content</option>
            <option value="privacy">Privacy</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Helpful detail <span>(optional)</span>
          <textarea name="details" maxLength={1000} rows={3} />
        </label>
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
        {state === "sent" ? <p role="status">Thank you. The report is queued for review.</p> : null}
        {state === "error" ? <p role="alert">The report could not be sent. Please try again.</p> : null}
      </form>
    </details>
  );
}

function StoryLoading() {
  return (
    <main className="ss-story-state ss-story-state--loading">
      <span className="ss-story-state__rune" aria-hidden="true">S</span>
      <p className="ss-kicker">Preparing the scroll</p>
      <h1>Gathering pages and illuminations…</h1>
    </main>
  );
}

function StoryUnavailable({ mode }: { mode: "curated" | "community" }) {
  const surfaceRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useStoryTransitionArrival({
    ready: true,
    targetRef: surfaceRef,
    focusRef: headingRef,
    revealMode: "fade",
  });

  return (
    <main ref={surfaceRef} className="ss-story-state">
      <Link className="ss-story-state__back" href="/">← Library</Link>
      <span className="ss-story-state__rune" aria-hidden="true">?</span>
      <p className="ss-kicker">The trail fades here</p>
      <h1 ref={headingRef}>This scroll could not be opened.</h1>
      <p>
        {mode === "community"
          ? "It may be unavailable, removed, or still awaiting its illustrations."
          : "The local edition is unavailable just now. Please return to the library and try again."}
      </p>
    </main>
  );
}

function normalizeCommunityStory(value: unknown, fallbackSlug: string): StoryDocument | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const raw =
    root.story && typeof root.story === "object"
      ? (root.story as Record<string, unknown>)
      : root;
  if (typeof raw.title !== "string" || !Array.isArray(raw.chapters)) return null;

  const intro = raw.intro && typeof raw.intro === "object"
    ? (raw.intro as Record<string, unknown>)
    : null;
  const assets: StoryAsset[] = [];
  const introFrames: string[] = [];
  const cover = intro?.cover && typeof intro.cover === "object"
    ? (intro.cover as Record<string, unknown>)
    : null;
  if (cover && typeof cover.url === "string") {
    assets.push({
      id: "community-cover",
      type: "cover",
      path: cover.url,
      alt: typeof cover.alt === "string" ? cover.alt : "Story cover",
    });
    introFrames.push("community-cover");
  }
  if (Array.isArray(intro?.scenes)) {
    intro.scenes.forEach((scene, index) => {
      if (!scene || typeof scene !== "object") return;
      const record = scene as Record<string, unknown>;
      if (typeof record.url !== "string") return;
      const id = `community-scene-${index + 1}`;
      assets.push({
        id,
        type: "illustration",
        path: record.url,
        alt: typeof record.alt === "string" ? record.alt : "Story scene",
      });
      introFrames.push(id);
    });
  }
  if (Array.isArray(raw.assets)) {
    raw.assets.forEach((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const asset = value as Record<string, unknown>;
      if (
        typeof asset.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(asset.id) ||
        (asset.type !== "illustration" && asset.type !== "ai-illustration") ||
        typeof asset.path !== "string" ||
        !asset.path.startsWith("/media/community/") ||
        typeof asset.alt !== "string" ||
        !asset.alt.trim() ||
        assets.some((existing) => existing.id === asset.id)
      ) {
        return;
      }
      assets.push({
        id: asset.id,
        type: asset.type,
        path: asset.path,
        alt: asset.alt.trim(),
        creator: typeof asset.creator === "string" && asset.creator.trim()
          ? asset.creator.trim()
          : asset.type === "ai-illustration"
            ? "OpenAI GPT Image 2"
            : null,
        sha256: typeof asset.sha256 === "string" && /^[a-f0-9]{64}$/.test(asset.sha256)
          ? asset.sha256
          : null,
        width: Number.isInteger(asset.width) && Number(asset.width) > 0
          ? Number(asset.width)
          : null,
        height: Number.isInteger(asset.height) && Number(asset.height) > 0
          ? Number(asset.height)
          : null,
        bytes: Number.isInteger(asset.bytes) && Number(asset.bytes) > 0
          ? Number(asset.bytes)
          : null,
        mime: asset.mime === "image/webp" ? "image/webp" : null,
      });
    });
  }
  const assetIds = new Set(assets.map((asset) => asset.id));

  const source = raw.source && typeof raw.source === "object"
    ? (raw.source as Record<string, unknown>)
    : null;
  const sourceMetadata = source?.metadata && typeof source.metadata === "object"
    && !Array.isArray(source.metadata)
      ? source.metadata as Record<string, unknown>
      : null;
  const sourceUrls = source && Array.isArray(source.sourceUrls)
    ? [...new Set(source.sourceUrls.flatMap((value) => {
        const href = safeWebHref(typeof value === "string" ? value : undefined);
        return href && href.startsWith("https://") ? [href] : [];
      }))]
    : [];
  const rightsStatement = source && typeof source.statement === "string"
    ? source.statement.trim()
    : "";
  const themeId = typeof raw.themeId === "string" ? raw.themeId : "manuscript";
  const creatorName = typeof raw.authorName === "string" && raw.authorName.trim()
    ? raw.authorName.trim()
    : null;
  const originalAuthor = typeof sourceMetadata?.originalAuthor === "string"
    && sourceMetadata.originalAuthor.trim()
      ? sourceMetadata.originalAuthor.trim()
      : null;
  const sourceTitle = typeof sourceMetadata?.sourceTitle === "string"
    && sourceMetadata.sourceTitle.trim()
      ? sourceMetadata.sourceTitle.trim()
      : null;
  const canonicalUrl = safeWebHref(
    typeof sourceMetadata?.canonicalUrl === "string" ? sourceMetadata.canonicalUrl : undefined,
  );
  const generation = raw.generation && typeof raw.generation === "object"
    && !Array.isArray(raw.generation)
      ? raw.generation as Record<string, unknown>
      : null;
  const illuminatedGlyphs = normalizeIlluminatedGlyphs(generation?.illuminatedGlyphs);

  return {
    slug: typeof raw.slug === "string" ? raw.slug : fallbackSlug,
    title: raw.title,
    subtitle: typeof raw.synopsis === "string" ? raw.synopsis : null,
    author: originalAuthor || creatorName,
    creatorName,
    kind: "community",
    intro: { kind: "standard", frames: introFrames },
    theme: {
      id: themeId,
      illuminatedGlyphs,
      accent: communityAccent(themeId),
    },
    source: {
      name: sourceTitle || (source && typeof source.basis === "string" ? source.basis : "Creator supplied"),
      url: canonicalUrl || sourceUrls[0],
      canonicalUrl: canonicalUrl || undefined,
      sourceUrls: canonicalUrl ? [...new Set([canonicalUrl, ...sourceUrls])] : sourceUrls,
      sourceTitle,
      originalAuthor,
      edition: typeof sourceMetadata?.edition === "string" && sourceMetadata.edition.trim()
        ? sourceMetadata.edition.trim()
        : undefined,
      originalLanguage:
        typeof sourceMetadata?.originalLanguage === "string" && sourceMetadata.originalLanguage.trim()
          ? sourceMetadata.originalLanguage.trim()
          : undefined,
      changeDescription:
        typeof sourceMetadata?.changeDescription === "string" && sourceMetadata.changeDescription.trim()
          ? sourceMetadata.changeDescription.trim()
          : undefined,
      gutenbergId: Number.isInteger(sourceMetadata?.gutenbergId)
        ? Number(sourceMetadata?.gutenbergId)
        : null,
    },
    rights: {
      status: source && typeof source.basis === "string" ? source.basis.replaceAll("_", " ") : "Creator supplied",
      statement: rightsStatement || undefined,
    },
    assets,
    chapters: raw.chapters.flatMap((chapter, index) => {
      if (!chapter || typeof chapter !== "object") return [];
      const record = chapter as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : `Chapter ${index + 1}`;
      const rawBlocks = Array.isArray(record.blocks) ? record.blocks : [];
      const blocks: StoryBlock[] = [];
      rawBlocks.forEach((block) => {
        if (!block || typeof block !== "object") return;
        const item = block as Record<string, unknown>;
        if (item.kind === "image") {
          if (typeof item.assetId !== "string" || !assetIds.has(item.assetId)) return;
          if (item.placement === "chapter-hero") {
            blocks.push({
              type: "image",
              assetId: item.assetId,
              placement: "chapter-hero",
              align: "hero",
            });
            return;
          }
          const requestedAlign = ["left", "right", "plate"].includes(String(item.align))
            ? item.align as "left" | "right" | "plate"
            : item.placement === "plate"
              ? "plate"
              : "right";
          blocks.push({
            type: "image",
            assetId: item.assetId,
            placement: requestedAlign === "plate" ? "plate" : "inline",
            align: requestedAlign,
          });
          return;
        }
        const kind = item.kind === "verse" ? "verse" : "paragraph";
        const text = typeof item.text === "string" ? item.text : "";
        if (!text) return;
        blocks.push(
          kind === "verse"
            ? { type: "verse", lines: text.split(/\r?\n/) }
            : { type: "paragraph", text },
        );
      });
      return [{ id: `chapter-${index + 1}`, number: index + 1, title, blocks }];
    }),
    adaptation: parseStoryAdaptation(raw.adaptation),
    generation: generation
      ? {
          ...generation,
          fontFamily:
            generation.fontFamily === "homemade-apple"
            || generation.fontFamily === "caveat-brush"
            || generation.fontFamily === "classic-serif"
            || generation.fontFamily === "literata"
            || generation.fontFamily === "atkinson-hyperlegible"
            || generation.fontFamily === "nunito"
              ? generation.fontFamily
              : null,
          illuminatedSetId:
            typeof generation.illuminatedSetId === "string"
            && /^illuminatedletters:[a-z0-9][a-z0-9-]{0,159}$/i.test(generation.illuminatedSetId)
              ? generation.illuminatedSetId
              : null,
          illuminatedSetName:
            typeof generation.illuminatedSetName === "string"
            && generation.illuminatedSetName.trim()
              ? generation.illuminatedSetName.trim().slice(0, 180)
              : null,
          illuminatedCatalogVersion:
            typeof generation.illuminatedCatalogVersion === "string"
            && generation.illuminatedCatalogVersion.trim()
              ? generation.illuminatedCatalogVersion.trim().slice(0, 100)
              : null,
          illuminatedSetFamily:
            typeof generation.illuminatedSetFamily === "string"
            && generation.illuminatedSetFamily.trim()
              ? generation.illuminatedSetFamily.trim().slice(0, 180)
              : null,
          illuminatedSetVersion:
            typeof generation.illuminatedSetVersion === "number"
            || typeof generation.illuminatedSetVersion === "string"
              ? generation.illuminatedSetVersion
              : null,
          illuminatedGlyphs,
          illuminatedGlyphsSha256:
            typeof generation.illuminatedGlyphsSha256 === "string"
            && /^[a-f0-9]{64}$/i.test(generation.illuminatedGlyphsSha256)
              ? generation.illuminatedGlyphsSha256.toLowerCase()
              : null,
          illuminatedDerivativePolicy:
            generation.illuminatedDerivativePolicy === "used-initials-only-384px-opaque-paths"
              ? generation.illuminatedDerivativePolicy
              : null,
        }
      : null,
    visibility:
      raw.accessLevel === "private" || raw.accessLevel === "unlisted" || raw.accessLevel === "public"
        ? raw.accessLevel
        : "public",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
  };
}

function normalizeIlluminatedGlyphs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [rawCharacter, rawPath] of Object.entries(value as Record<string, unknown>)) {
    const character = rawCharacter.toLocaleLowerCase();
    if (!/^[a-z0-9]$/.test(character) || typeof rawPath !== "string") continue;
    const isCommunityDerivative = /^\/media\/community\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{40}\.webp$/i.test(rawPath);
    const isCuratedDerivative = /^\/assets\/story-initials\/[0-9a-f]{32}\/[0-9a-f]{40}\.webp$/i.test(rawPath);
    if (isCommunityDerivative || isCuratedDerivative) normalized[character] = rawPath;
  }
  return normalized;
}

async function sha256Json(value: unknown): Promise<string | null> {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function normalizeAiIllustrationManifest(
  value: unknown,
  story: StoryDocument,
): Promise<AiIllustrationManifest | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const generation = root.generation && typeof root.generation === "object"
    ? root.generation as Record<string, unknown>
    : null;
  const schemaVersion = root.schemaVersion;
  if (
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    root.storySlug !== story.slug ||
    generation?.provider !== "OpenAI" ||
    generation.model !== "gpt-image-2" ||
    generation.quality !== "low" ||
    !Array.isArray(root.assets) ||
    !Array.isArray(root.placements)
  ) {
    return null;
  }

  const escapedSlug = story.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathPattern = new RegExp(
    `^/stories/${escapedSlug}/ai-images/[a-z0-9][a-z0-9-]*-[a-f0-9]{12}\\.webp$`,
  );
  const assets = root.assets.flatMap((value): AiIllustrationAsset[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const asset = value as Record<string, unknown>;
    if (
      typeof asset.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(asset.id) ||
      asset.type !== "ai-illustration" ||
      typeof asset.path !== "string" ||
      !pathPattern.test(asset.path) ||
      typeof asset.alt !== "string" ||
      !asset.alt.trim() ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !asset.path.endsWith(`-${asset.sha256.slice(0, 12)}.webp`) ||
      !Number.isInteger(asset.width) ||
      Number(asset.width) <= 0 ||
      !Number.isInteger(asset.height) ||
      Number(asset.height) <= 0 ||
      !Number.isInteger(asset.bytes) ||
      Number(asset.bytes) <= 0 ||
      asset.mime !== "image/webp"
    ) {
      return [];
    }
    return [{
      id: asset.id,
      type: "ai-illustration",
      path: asset.path,
      alt: asset.alt.trim(),
      caption: typeof asset.caption === "string" && asset.caption.trim()
        ? asset.caption.trim()
        : null,
      creator: "OpenAI GPT Image 2",
      sha256: asset.sha256,
      width: Number(asset.width),
      height: Number(asset.height),
      bytes: Number(asset.bytes),
      mime: "image/webp",
    }];
  });
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  if (!assetMap.size || assetMap.size !== assets.length) return null;

  const chapterMap = new Map(story.chapters.map((chapter) => [chapter.id, chapter]));
  const placedAssets = new Set<string>();
  const heroChapters = new Set<string>();
  const placements: AiIllustrationPlacement[] = [];
  for (const value of root.placements) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const placement = value as Record<string, unknown>;
    const chapter = typeof placement.chapterId === "string"
      ? chapterMap.get(placement.chapterId)
      : undefined;
    if (
      !chapter ||
      typeof placement.assetId !== "string" ||
      !assetMap.has(placement.assetId) ||
      placedAssets.has(placement.assetId)
    ) {
      return null;
    }

    const asset = assetMap.get(placement.assetId);
    if (!asset) return null;

    if (schemaVersion === 2 && placement.kind === "chapter-hero") {
      if (
        heroChapters.has(chapter.id) ||
        typeof placement.chapterSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(placement.chapterSha256) ||
        asset.width !== 1344 ||
        asset.height !== 576
      ) {
        return null;
      }
      placedAssets.add(placement.assetId);
      heroChapters.add(chapter.id);
      placements.push({
        kind: "chapter-hero",
        chapterId: chapter.id,
        chapterSha256: placement.chapterSha256,
        assetId: placement.assetId,
      });
      continue;
    }

    if (
      (schemaVersion === 2 && placement.kind !== "after-block") ||
      !Number.isInteger(placement.afterBlockIndex) ||
      Number(placement.afterBlockIndex) < 0 ||
      Number(placement.afterBlockIndex) >= chapter.blocks.length ||
      typeof placement.anchorSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(placement.anchorSha256) ||
      (placement.placement !== "inline" && placement.placement !== "plate") ||
      !["left", "right", "plate"].includes(String(placement.align)) ||
      ((placement.placement === "plate") !== (placement.align === "plate"))
    ) {
      return null;
    }
    placedAssets.add(placement.assetId);
    placements.push({
      kind: "after-block",
      chapterId: chapter.id,
      afterBlockIndex: Number(placement.afterBlockIndex),
      anchorSha256: placement.anchorSha256,
      assetId: placement.assetId,
      placement: placement.placement,
      align: placement.align as "left" | "right" | "plate",
    });
  }
  if (!placements.length || placedAssets.size !== assetMap.size) return null;
  if (schemaVersion === 2 && heroChapters.size !== story.chapters.length) return null;
  const anchorsMatch = await Promise.all(placements.map(async (placement) => {
    const chapter = chapterMap.get(placement.chapterId);
    if (!chapter) return false;
    if (placement.kind === "chapter-hero") {
      const anchor = await sha256Json(chapter);
      return anchor === placement.chapterSha256;
    }
    const anchor = await sha256Json(chapter.blocks[placement.afterBlockIndex]);
    return anchor === placement.anchorSha256;
  }));
  if (!anchorsMatch.every(Boolean)) return null;

  return {
    schemaVersion,
    storySlug: story.slug,
    generation: {
      provider: "OpenAI",
      model: "gpt-image-2",
      quality: "low",
    },
    assets,
    placements,
  };
}

function removeOpeningCharacter(runs: StoryRun[], initial: string): StoryRun[] {
  let removed = false;
  const target = initial.toLocaleLowerCase();
  return runs.map((run) => {
    if (removed || !run.text) return run;
    const index = run.text.search(/\S/);
    if (index < 0) return run;
    const candidate = run.text.slice(index, index + 1).toLocaleLowerCase();
    if (candidate !== target) return run;
    removed = true;
    return { ...run, text: `${run.text.slice(0, index)}${run.text.slice(index + 1)}` };
  });
}

function storySourceUrl(story: StoryDocument): string | null {
  return storySourceUrls(story)[0] ?? null;
}

function storySourceUrls(story: StoryDocument): string[] {
  const additional = Array.isArray(story.source?.sourceUrls)
    ? story.source.sourceUrls
    : [];
  const candidates = [
    story.source?.canonicalUrl,
    story.source?.url,
    story.source?.textCatalogUrl,
    story.source?.textUrl,
    ...additional,
  ];
  return [...new Set(candidates.flatMap((candidate) => {
    const href = safeWebHref(typeof candidate === "string" ? candidate : undefined);
    return href && href.startsWith("http") ? [href] : [];
  }))];
}

function readerFacingSourceText(value: string): string {
  return value
    .replace(/\bProject Gutenberg\s+(?:eBook|ebook)\b/gi, "Public-domain eBook")
    .replace(/\bProject Gutenberg\b/gi, "the public-domain source library")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isSourceLibraryUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    return hostname === "gutenberg.org" || hostname.endsWith(".gutenberg.org");
  } catch {
    return false;
  }
}

function sourceLinkLabel(url: string, index: number, total: number): string {
  if (isSourceLibraryUrl(url)) {
    return total === 1 ? "Original public-domain edition" : `Public-domain source ${index + 1}`;
  }
  return new URL(url).hostname;
}

function storyRightsLabel(story: StoryDocument): string | null {
  const candidate =
    story.rights?.notice ??
    story.rights?.licenseLabel ??
    story.rights?.license ??
    story.rights?.status;
  return typeof candidate === "string" && candidate.trim()
    ? readerFacingSourceText(candidate)
    : null;
}

function storyRightsStatement(story: StoryDocument): string | null {
  const candidate = story.rights?.statement;
  return typeof candidate === "string" && candidate.trim()
    ? readerFacingSourceText(candidate)
    : null;
}

function safeWebHref(value?: string): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function safeCssColor(value?: string): string | null {
  if (!value) return null;
  return /^(#[0-9a-f]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))$/i.test(value.trim())
    ? value.trim()
    : null;
}

function storyVariant(story: StoryDocument): string {
  if (story.slug.includes("alice")) return "alice";
  if (story.slug.includes("oz")) return "oz";
  return story.kind === "community" ? "community" : "classic";
}

function defaultAccent(slug: string): string {
  if (slug.includes("alice")) return "#a8473e";
  if (slug.includes("oz")) return "#24705a";
  return "#8c4c31";
}

function communityAccent(theme: string): string {
  if (theme === "irish") return "#426b4f";
  if (theme === "gemstone") return "#5f4c92";
  if (theme === "stained-glass") return "#386b78";
  return "#765b3f";
}

function storyTypographyLabel(story: StoryDocument): string | null {
  const font = story.generation?.fontFamily;
  const setId = story.generation?.illuminatedSetId || story.theme?.illuminatedSetId;
  const setName = story.generation?.illuminatedSetName || story.theme?.illuminatedSetName;
  const setVersion = story.generation?.illuminatedSetVersion || story.theme?.illuminatedSetVersion;
  const parts: string[] = [];
  if (font === "homemade-apple") parts.push("Homemade Apple text");
  else if (font === "caveat-brush") parts.push("Caveat Brush text");
  else if (font === "classic-serif") parts.push("classic book serif text");
  else if (font === "literata") parts.push("Literata text");
  else if (font === "atkinson-hyperlegible") parts.push("Atkinson Hyperlegible text");
  else if (font === "nunito") parts.push("Nunito text");
  if (setName) {
    parts.push(`${setName} illuminated initials by Illuminated Letters${setVersion ? ` (v${setVersion})` : ""}`);
  }
  else if (setId) {
    const readable = setId.replace(/^illuminatedletters:/, "").replaceAll(/[-_]+/g, " ");
    parts.push(`${readable} illuminated initials`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function adaptationEditionLabel(story: StoryDocument): string | null {
  const adaptation = story.adaptation;
  if (!adaptation) return null;
  const labels: string[] = [];
  if (adaptation.transformation.mode === "summary") {
    labels.push(
      adaptation.transformation.summaryLevel === "brief"
        ? "Brief story digest"
        : adaptation.transformation.summaryLevel === "detailed"
          ? "Detailed story digest"
          : "Story digest",
    );
  }
  if (adaptation.transformation.targetLanguage) {
    labels.push(`Translated into ${adaptation.transformation.targetLanguage}`);
  }
  if (adaptation.transformation.modernization === "light") {
    labels.push("Lightly modernized language");
  } else if (adaptation.transformation.modernization === "full") {
    labels.push("Contemporary-language edition");
  }
  if (adaptation.transformation.reimagination?.enabled) {
    labels.push("Reimagined edition");
  }
  const targetAge = adaptation.audience.targetAge;
  if (adaptation.audience.format === "picture_book") {
    labels.push(
      targetAge ? `Image-only picture book for age ${targetAge}` : "Image-only picture book",
    );
  } else if (targetAge) {
    labels.push(`Adapted for readers around age ${targetAge}`);
  }
  return labels.length ? labels.join(" · ") : null;
}

function adaptationCraftLabel(story: StoryDocument): string | null {
  const adaptation = story.adaptation;
  if (!adaptation) return null;
  const labels: string[] = [];
  if (adaptation.qualityProfile) {
    const profile = adaptation.qualityProfile === "custom"
      ? "Custom craft plan"
      : `${adaptation.qualityProfile.replaceAll("_", " ")} craft plan`;
    labels.push(profile.replace(/^./, (character) => character.toUpperCase()));
  }
  if (Number.isInteger(adaptation.refinementPasses) && Number(adaptation.refinementPasses) > 0) {
    const passes = Number(adaptation.refinementPasses);
    labels.push(`${passes} editorial refinement ${passes === 1 ? "pass" : "passes"}`);
  }
  if (adaptation.imageTier) {
    labels.push(`${adaptation.imageTier.replaceAll("_", " ")} art fidelity`);
  }
  if (adaptation.outputSize) {
    labels.push(`${adaptation.outputSize.replaceAll("_", " ")} delivery`);
  }
  return labels.length ? labels.join(" · ") : null;
}

function adaptationGenerationLabel(story: StoryDocument): string | null {
  const adaptation = story.adaptation;
  if (!adaptation?.textModel) return null;
  const model = adaptation.textModel
    .replace(/^gpt-/i, "GPT ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const passes = adaptation.textRequestCount;
  if (!passes) return model;
  return `${model} · ${passes} structured text ${passes === 1 ? "pass" : "passes"}`;
}

function storyAiIllustratorLabel(story: StoryDocument): string | null {
  const asset = story.assets.find((candidate) => candidate.type === "ai-illustration");
  if (!asset) return null;
  const continuity = story.adaptation?.continuityReferenceApproved
    ? ` · creator-approved ${story.adaptation.continuityReferenceQuality || "low"}-quality visual reference used for continuity`
    : "";
  return `Illustrated with ${asset.creator || "OpenAI GPT Image 2"}${continuity}`;
}

function chapterAnchor(chapter: StoryChapter, index: number): string {
  const id = chapter.id?.trim();
  if (id && /^[a-z0-9][a-z0-9_-]*$/i.test(id)) return id;
  return `chapter-${index + 1}`;
}

function padChapter(value: number): string {
  return String(value).padStart(2, "0");
}

function slugClass(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

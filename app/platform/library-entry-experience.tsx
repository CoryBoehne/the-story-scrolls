"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CURATED_LIBRARY, type CuratedLibraryBook } from "../data/curated-library";
import { FittedTitle } from "./fitted-title";
import { ImageTextureOverlay } from "./image-texture-overlay";
import { PlatformFooter, PlatformHeader } from "./site-shell";
import { type LibraryStory } from "./story-types";

const MANIFEST_URL = "/assets/library-intro/manifest.json";
const FRAME_CACHE_LIMIT = 12;
const FRAME_WINDOW_RADIUS = 4;
const PRELOAD_CONCURRENCY = 8;
const PRELOAD_TIMEOUT_MS = 45_000;
const LOADER_MINIMUM_MS = 3_400;
const LOADER_SCROLL_CUE_MS = 21_650;
const LOADER_REDUCED_MOTION_CUE_MS = 650;
const LOADER_EXIT_MS = 950;
const FIRST_FRAME_GRACE_MS = 1_800;
const RESIZE_DEBOUNCE_MS = 180;
const INTRO_DISTANCE_VH = 3.15;
const PAGE_HOLD_VH = 0.21;
const PAGE_TURN_VH = 0.33;
const PAGE_OUT_FADE_START = 0.295;
const PAGE_OUT_FADE_END = 0.352;
const PAGE_IN_FADE_START = 0.532;
const PAGE_IN_FADE_END = 0.607;
const CANVAS_PIXEL_BUDGET = 4_500_000;
const INTRO_FOLIO_COUNT = 2;

type SequenceVariant = {
  id: string;
  width: number;
  height: number;
  quality: number;
  basePath: string;
  filePattern: string;
  bytes: number;
};

type SequenceManifest = {
  version: number;
  source: {
    count: number;
    fps: number;
    splitFrame: number;
  };
  frames: {
    count: number;
    openingEndIndex: number;
    turnStartIndex: number;
    turnCount: number;
    sourceFrameIndexes: number[];
  };
  variants: SequenceVariant[];
};

type AssetState = {
  manifest: SequenceManifest | null;
  variant: SequenceVariant | null;
  settled: number;
  total: number;
  failed: number;
  progress: number;
  ready: boolean;
  reducedMotion: boolean;
  unavailable: boolean;
};

const INITIAL_ASSET_STATE: AssetState = {
  manifest: null,
  variant: null,
  settled: 0,
  total: 1,
  failed: 0,
  progress: 0,
  ready: false,
  reducedMotion: false,
  unavailable: false,
};

const FEATURED_STORIES = [
  {
    slug: "alice-in-wonderland",
    title: "Alice’s Adventures in Wonderland",
    author: "Lewis Carroll",
    eyebrow: "Curated classic",
    description:
      "Twelve strange, clever chapters tumbling through John Tenniel’s original Wonderland illustrations.",
    href: "/stories/alice-in-wonderland/",
    image: "/assets/library-covers/alice-in-wonderland.webp",
    format: "Public-domain edition",
  },
  {
    slug: "the-wonderful-wizard-of-oz",
    title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum",
    eyebrow: "Curated classic",
    description:
      "Follow the road from gray Kansas to Emerald City through W. W. Denslow’s exuberant 1900 artwork.",
    href: "/stories/the-wonderful-wizard-of-oz/",
    image: "/assets/library-covers/the-wonderful-wizard-of-oz.webp",
    format: "Public-domain edition",
  },
] as const;

type LibraryEntryExperienceProps = {
  community: LibraryStory[];
  communityState: "loading" | "ready" | "unavailable";
};

type CachedFrame = {
  image: HTMLImageElement;
  ready: boolean;
  touched: number;
};

type IntroBeat = {
  start: number;
  end: number;
  copy: string;
};

const INTRO_BEATS: readonly IntroBeat[] = [
  {
    start: 0.08,
    end: 0.29,
    copy: "Every story begins as a mark in the dark.",
  },
  {
    start: 0.3,
    end: 0.5,
    copy: "A word becomes a path. A page becomes a world.",
  },
  {
    start: 0.77,
    end: 0.94,
    copy: "Let’s make reading feel like wonder again.",
  },
] as const;

const LOADER_MESSAGES: readonly { copy: string; emphasis?: string }[] = [
  { copy: "Welcome to The Story Scrolls" },
  { copy: "The story was always meant to move" },
  { copy: "not just on a screen" },
  { copy: "but through", emphasis: "you" },
] as const;

const LOADER_ALPHABET = "THESTORYSCROLLSREADWANDERIMAGINEABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOADER_GLYPHS = Array.from({ length: 48 }, (_, index) => {
  const edge = index % 4;
  const spread = ((index * 47 + 19) % 101) - 50;
  const fromX = edge === 1 ? 61 : edge === 3 ? -61 : spread;
  const fromY = edge === 0 ? -61 : edge === 2 ? 61 : spread;
  const angle = ((index * 137.508 + 17) % 360) * (Math.PI / 180);
  const point = (radius: number, offset: number) => ({
    x: Math.cos(angle + offset) * radius,
    y: Math.sin(angle + offset) * radius,
  });
  const outer = point(44 + (index % 7), 0);
  const orbit = point(36 + (index % 6), 1.6);
  const middle = point(27 + (index % 5), 3.15);
  const inner = point(16 + (index % 4), 4.7);
  const near = point(7 + (index % 3), 6.2);

  return {
    character: LOADER_ALPHABET[index % LOADER_ALPHABET.length],
    fromX: `${fromX}vw`,
    fromY: `${fromY}vh`,
    outerX: `${outer.x.toFixed(2)}vmin`,
    outerY: `${outer.y.toFixed(2)}vmin`,
    orbitX: `${orbit.x.toFixed(2)}vmin`,
    orbitY: `${orbit.y.toFixed(2)}vmin`,
    middleX: `${middle.x.toFixed(2)}vmin`,
    middleY: `${middle.y.toFixed(2)}vmin`,
    innerX: `${inner.x.toFixed(2)}vmin`,
    innerY: `${inner.y.toFixed(2)}vmin`,
    nearX: `${near.x.toFixed(2)}vmin`,
    nearY: `${near.y.toFixed(2)}vmin`,
    duration: `${(12.8 + (index % 7) * 0.72).toFixed(2)}s`,
    delay: `${((index % 12) * 0.18 + Math.floor(index / 12) * 0.16).toFixed(2)}s`,
    resolveDelay: `${(index * 83) % 520}ms`,
    size: `${(1 + (index % 6) * 0.16).toFixed(2)}rem`,
    tilt: `${-110 + ((index * 47) % 220)}deg`,
  };
});

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(start: number, end: number, value: number) {
  if (start === end) return value < start ? 0 : 1;
  const amount = clamp((value - start) / (end - start));
  return amount * amount * (3 - 2 * amount);
}

function scrollWindowInstantly(top: number) {
  const root = document.documentElement;
  root.classList.add("ss-instant-scroll");
  window.scrollTo({ top, left: window.scrollX, behavior: "auto" });
  window.requestAnimationFrame(() => root.classList.remove("ss-instant-scroll"));
}

function chunkItems<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type CuratedFolioLayout = {
  columns: 1 | 2;
  rows: number;
  itemsPerPage: number;
  featuredItemsPerPage: 1 | 2;
  pageScale: number;
  zoomLocked: boolean;
};

const DEFAULT_CURATED_FOLIO_LAYOUT: CuratedFolioLayout = {
  columns: 2,
  rows: 2,
  itemsPerPage: 4,
  featuredItemsPerPage: 2,
  pageScale: 1,
  zoomLocked: false,
};

function measureCuratedFolioLayout(): CuratedFolioLayout {
  const width = Math.max(1, Math.round(window.visualViewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(window.visualViewport?.height ?? window.innerHeight));
  const columns: 1 | 2 = width >= 820 ? 2 : 1;
  const zoomLocked = (width < 560 && height < 700) || (width < 900 && height < 520);
  const pageScale = zoomLocked
    ? Math.max(0.82, Math.min(1, height / (width < 560 ? 700 : 520)))
    : 1;
  const reservedHeight = height < 680 ? 185 : height < 860 ? 220 : 250;
  const targetRowHeight = columns === 2 ? 172 : 132;
  const maximumRows = columns === 2 ? 3 : height >= 1_020 ? 4 : 3;
  const measuredRows = Math.max(
    1,
    Math.min(maximumRows, Math.floor((height / pageScale - reservedHeight) / targetRowHeight)),
  );
  const rows = height < 580
    ? 1
    : zoomLocked
      ? Math.min(2, measuredRows)
      : Math.max(2, measuredRows);
  const featuredItemsPerPage: 1 | 2 = columns === 1 && (width < 360 || height < 760)
    ? 1
    : 2;

  return {
    columns,
    rows,
    itemsPerPage: columns * rows,
    featuredItemsPerPage,
    pageScale,
    zoomLocked,
  };
}

function useCuratedFolioLayout() {
  const [layout, setLayout] = useState<CuratedFolioLayout>(DEFAULT_CURATED_FOLIO_LAYOUT);
  const layoutRef = useRef(DEFAULT_CURATED_FOLIO_LAYOUT);
  const preservedStoryHref = useRef<string | null>(null);

  useEffect(() => {
    let resizeTimer = 0;

    const update = () => {
      const measured = measureCuratedFolioLayout();
      const current = layoutRef.current;
      const unchanged = current.columns === measured.columns
        && current.rows === measured.rows
        && current.itemsPerPage === measured.itemsPerPage
        && current.featuredItemsPerPage === measured.featuredItemsPerPage
        && current.pageScale === measured.pageScale
        && current.zoomLocked === measured.zoomLocked;
      if (unchanged) return;

      const activeFolio = document.querySelector<HTMLElement>(
        '.ss-library-folio[aria-hidden="false"]',
      );
      preservedStoryHref.current = activeFolio
        ?.querySelector<HTMLAnchorElement>('a[href^="/stories/"]')
        ?.getAttribute("href") ?? null;
      layoutRef.current = measured;
      setLayout(measured);
    };

    const scheduleUpdate = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(update, RESIZE_DEBOUNCE_MS);
    };

    update();
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleUpdate, { passive: true });

    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  return { layout, preservedStoryHref };
}

function selectVariant(manifest: SequenceManifest) {
  const targetWidth = Math.max(
    window.innerWidth,
    Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 1.5)),
  );
  return [...manifest.variants].sort((left, right) => left.width - right.width)
    .find((variant) => variant.width >= targetWidth)
    ?? [...manifest.variants].sort((left, right) => right.width - left.width)[0];
}

function frameUrl(variant: SequenceVariant, index: number) {
  const filename = variant.filePattern.replace(
    "{index:000}",
    String(index).padStart(3, "0"),
  );
  return `${variant.basePath}/${filename}`;
}

async function warmAsset(url: string, signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "force-cache",
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) throw new Error(`Could not preload ${url} (${response.status})`);
      await response.blob();
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not preload ${url}`);
}

function useLibrarySequenceAssets() {
  const [state, setState] = useState<AssetState>(INITIAL_ASSET_STATE);

  useEffect(() => {
    const controller = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timeout = 0;

    const load = async () => {
      try {
        const response = await fetch(MANIFEST_URL, {
          cache: "force-cache",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Sequence manifest failed (${response.status})`);
        const manifest = await response.json() as SequenceManifest;
        const variant = selectVariant(manifest);
        const indexes = reducedMotion
          ? [0, manifest.frames.openingEndIndex, manifest.frames.count - 1]
          : Array.from({ length: manifest.frames.count }, (_, index) => index);
        const urls = [...new Set(indexes)].map((index) => frameUrl(variant, index));
        const total = urls.length;
        let cursor = 0;
        let settled = 0;
        let failed = 0;

        setState({
          manifest,
          variant,
          settled: 0,
          total,
          failed: 0,
          progress: 0,
          ready: false,
          reducedMotion,
          unavailable: false,
        });

        const report = (ready = false) => {
          if (controller.signal.aborted) return;
          setState({
            manifest,
            variant,
            settled,
            total,
            failed,
            progress: total ? settled / total : 1,
            ready,
            reducedMotion,
            unavailable: false,
          });
        };

        const workers = Array.from(
          { length: Math.min(PRELOAD_CONCURRENCY, urls.length) },
          async () => {
            while (!controller.signal.aborted) {
              const index = cursor;
              cursor += 1;
              if (index >= urls.length) return;
              try {
                await warmAsset(urls[index], controller.signal);
              } catch {
                if (controller.signal.aborted) return;
                failed += 1;
              }
              settled += 1;
              if (settled === total || settled % 3 === 0) report(false);
            }
          },
        );

        const timedOut = new Promise<"timeout">((resolve) => {
          timeout = window.setTimeout(() => resolve("timeout"), PRELOAD_TIMEOUT_MS);
        });
        const result = await Promise.race([
          Promise.all(workers).then(() => "complete" as const),
          timedOut,
        ]);

        if (timeout) window.clearTimeout(timeout);
        if (controller.signal.aborted) return;
        if (result === "timeout") {
          failed += Math.max(0, total - settled);
          settled = total;
        }
        report(true);
      } catch {
        if (controller.signal.aborted) return;
        setState({
          ...INITIAL_ASSET_STATE,
          progress: 1,
          ready: true,
          reducedMotion,
          unavailable: true,
        });
      }
    };

    void load();
    return () => {
      if (timeout) window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return state;
}

function drawSequenceFrame(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoomProgress: number,
) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !image.naturalWidth || !image.naturalHeight) return;
  const containScale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const coverScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const zoom = clamp(zoomProgress);
  const scale = containScale * Math.pow(coverScale / containScale, zoom);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
}

function LibraryLoader({
  progress,
  failed,
  ready,
  reducedMotion,
  leaving,
  onComplete,
}: {
  progress: number;
  failed: number;
  ready: boolean;
  reducedMotion: boolean;
  leaving: boolean;
  onComplete: () => void;
}) {
  const completionRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const [acceptingScroll, setAcceptingScroll] = useState(false);
  const percentage = Math.round(clamp(progress) * 100);
  const activeGlyphs = ready
    ? LOADER_GLYPHS.length
    : Math.max(6, Math.ceil(6 + clamp(progress) * (LOADER_GLYPHS.length - 6)));
  const status = percentage >= 100
    ? failed
      ? "The library is open; a few details will arrive as you wander."
      : "The first page is ready."
    : percentage < 20
      ? "Lighting the scriptorium…"
      : percentage < 70
        ? "Gathering the painted pages…"
        : "Binding the living library…";

  useEffect(() => {
    if (!ready || completionRef.current) {
      setAcceptingScroll(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!completionRef.current) setAcceptingScroll(true);
    }, reducedMotion ? LOADER_REDUCED_MOTION_CUE_MS : LOADER_SCROLL_CUE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, reducedMotion]);

  const finishOpening = useCallback(() => {
    if (completionRef.current) return;
    completionRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (!acceptingScroll || leaving) return;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 2) finishOpening();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) finishOpening();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      const endY = event.changedTouches[0]?.clientY;
      touchStartYRef.current = null;
      if (startY != null && endY != null && startY - endY > 12) finishOpening();
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [acceptingScroll, finishOpening, leaving]);

  return (
    <section
      className={`ss-library-loader${ready ? " is-resolving" : ""}${leaving ? " is-leaving" : ""}`}
      aria-label="Loading The Story Scrolls library"
      aria-busy={!ready}
      style={{ "--ss-load-progress": clamp(progress) } as CSSProperties}
    >
      <div className="ss-library-loader__glyph-field" aria-hidden="true">
        {LOADER_GLYPHS.map((glyph, index) => (
          <span
            className={`ss-library-loader__glyph${index < activeGlyphs ? " is-active" : ""}`}
            key={`${glyph.character}-${index}`}
            style={{
              "--ss-from-x": glyph.fromX,
              "--ss-from-y": glyph.fromY,
              "--ss-outer-x": glyph.outerX,
              "--ss-outer-y": glyph.outerY,
              "--ss-orbit-x": glyph.orbitX,
              "--ss-orbit-y": glyph.orbitY,
              "--ss-middle-x": glyph.middleX,
              "--ss-middle-y": glyph.middleY,
              "--ss-inner-x": glyph.innerX,
              "--ss-inner-y": glyph.innerY,
              "--ss-near-x": glyph.nearX,
              "--ss-near-y": glyph.nearY,
              "--ss-glyph-duration": glyph.duration,
              "--ss-glyph-delay": glyph.delay,
              "--ss-resolve-delay": glyph.resolveDelay,
              "--ss-glyph-size": glyph.size,
              "--ss-glyph-tilt": glyph.tilt,
            } as CSSProperties}
          >
            {glyph.character}
          </span>
        ))}
      </div>

      <div className="ss-library-loader__core">
        <div className="ss-library-loader__progress-state" aria-hidden={ready}>
          <p className="ss-library-loader__eyebrow">The Story Scrolls</p>
          <div
            className="ss-library-loader__progress"
            role="progressbar"
            aria-label="Loading the illustrated opening"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            aria-valuetext={status}
          >
            <i aria-hidden="true" />
          </div>
          <div className="ss-library-loader__meter-meta">
            <span>{status}</span>
            <strong>{percentage}%</strong>
          </div>
        </div>

        <div className="ss-library-loader__messages" aria-hidden="true">
          {LOADER_MESSAGES.map((message) => (
            <p className="ss-library-loader__message" key={message.copy}>
              {message.copy}{message.emphasis ? <> <em>{message.emphasis}</em></> : null}
            </p>
          ))}
          <button
            className={`ss-library-loader__message ss-library-loader__scroll-cue${acceptingScroll ? " is-ready" : ""}`}
            type="button"
            onClick={finishOpening}
          >
            <span>Scroll down to be moved.</span>
            <i aria-hidden="true">↓</i>
          </button>
        </div>
      </div>

      {ready ? (
        <button className="ss-library-loader__skip" type="button" onClick={finishOpening}>
          Skip opening
        </button>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {ready ? "Welcome to The Story Scrolls. The story was always meant to move, not just on a screen, but through you. Scroll down to be moved." : status}
      </p>
    </section>
  );
}

type CinematicStageProps = {
  manifest: SequenceManifest | null;
  variant: SequenceVariant | null;
  reducedMotion: boolean;
  unavailable: boolean;
  onFirstFrameReady: () => void;
  onPageChange: (page: number) => void;
  onLibraryReveal: (revealed: boolean) => void;
  children: React.ReactNode;
  activePage: number;
  pageCount: number;
  curatedStartPage: number;
  pageLabels: string[];
  pageScale: number;
  zoomLocked: boolean;
};

function LibraryCinematicStage({
  manifest,
  variant,
  reducedMotion,
  unavailable,
  onFirstFrameReady,
  onPageChange,
  onLibraryReveal,
  children,
  activePage,
  pageCount,
  curatedStartPage,
  pageLabels,
  pageScale,
  zoomLocked,
}: CinematicStageProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foliosRef = useRef<Array<HTMLElement | null>>([]);
  const beatsRef = useRef<Array<HTMLParagraphElement | null>>([]);
  const cacheRef = useRef(new Map<number, CachedFrame>());
  const touchCounter = useRef(0);
  const targetFrame = useRef(0);
  const targetZoom = useRef(0);
  const lastFrame = useRef(-1);
  const lastZoom = useRef(-1);
  const activePageRef = useRef(-1);
  const libraryRevealedRef = useRef(false);
  const animationFrame = useRef(0);
  const resizeTimer = useRef<number | null>(null);
  const metricsRef = useRef({
    viewportHeight: 1,
    introDistance: 1,
    holdDistance: 1,
    turnDistance: 1,
  });

  const setFolioRef = useCallback((index: number, element: HTMLElement | null) => {
    foliosRef.current[index] = element;
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!section || !stage || !canvas) return;

    if (unavailable) {
      onFirstFrameReady();
      onLibraryReveal(true);
      onPageChange(0);
      return;
    }

    if (!manifest || !variant) return;

    if (reducedMotion) {
      onFirstFrameReady();
      onLibraryReveal(true);
      onPageChange(0);
      return;
    }

    const frameCount = manifest.frames.count;
    const openingEndIndex = manifest.frames.openingEndIndex;
    const turnStartIndex = manifest.frames.turnStartIndex;
    const turnCount = manifest.frames.turnCount;
    const selectedVariant = variant;
    const folios = foliosRef.current;

    const cache = cacheRef.current;

    const evictFrames = (protectedIndex: number) => {
      if (cache.size <= FRAME_CACHE_LIMIT) return;
      const candidates = [...cache.entries()]
        .filter(([index]) => Math.abs(index - protectedIndex) > 3)
        .sort((left, right) => left[1].touched - right[1].touched);
      while (cache.size > FRAME_CACHE_LIMIT && candidates.length) {
        const [index, entry] = candidates.shift()!;
        cache.delete(index);
        entry.image.onload = null;
        entry.image.onerror = null;
        entry.image.removeAttribute("src");
      }
    };

    const nearestReadyFrame = (requested: number) => {
      const exact = cache.get(requested);
      if (exact?.ready) return [requested, exact] as const;
      let nearest: readonly [number, CachedFrame] | null = null;
      for (const item of cache.entries()) {
        if (!item[1].ready || Math.abs(item[0] - requested) > FRAME_WINDOW_RADIUS + 2) continue;
        if (!nearest || Math.abs(item[0] - requested) < Math.abs(nearest[0] - requested)) {
          nearest = item;
        }
      }
      return nearest;
    };

    const drawNearest = () => {
      const nearest = nearestReadyFrame(targetFrame.current);
      if (!nearest) return;
      nearest[1].touched = ++touchCounter.current;
      if (
        nearest[0] === lastFrame.current
        && Math.abs(targetZoom.current - lastZoom.current) < 0.002
      ) return;
      drawSequenceFrame(canvas, nearest[1].image, targetZoom.current);
      lastFrame.current = nearest[0];
      lastZoom.current = targetZoom.current;
      canvas.classList.add("is-ready");
      if (nearest[0] === 0) onFirstFrameReady();
    };

    const ensureFrame = (index: number) => {
      if (index < 0 || index >= frameCount) return;
      const existing = cache.get(index);
      if (existing) {
        existing.touched = ++touchCounter.current;
        return;
      }
      const image = new Image();
      const entry: CachedFrame = {
        image,
        ready: false,
        touched: ++touchCounter.current,
      };
      cache.set(index, entry);
      image.decoding = "async";
      image.onload = () => {
        entry.ready = true;
        entry.touched = ++touchCounter.current;
        if (Math.abs(index - targetFrame.current) <= 2 || lastFrame.current < 0) drawNearest();
        evictFrames(targetFrame.current);
      };
      image.onerror = () => {
        cache.delete(index);
        drawNearest();
      };
      image.src = frameUrl(selectedVariant, index);
      evictFrames(targetFrame.current);
    };

    const warmWindow = (center: number) => {
      ensureFrame(center);
      for (let distance = 1; distance <= FRAME_WINDOW_RADIUS; distance += 1) {
        ensureFrame(center + distance);
        ensureFrame(center - distance);
      }
      for (let distance = FRAME_WINDOW_RADIUS + 1; distance <= FRAME_WINDOW_RADIUS + 3; distance += 1) {
        ensureFrame(center + distance);
      }
      evictFrames(center);
    };

    const viewportSize = () => ({
      width: Math.max(1, Math.round(window.visualViewport?.width ?? window.innerWidth)),
      height: Math.max(1, Math.round(window.visualViewport?.height ?? window.innerHeight)),
    });

    const sizeExperience = () => {
      const { width, height } = viewportSize();
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.75,
        Math.sqrt(CANVAS_PIXEL_BUDGET / (width * height)),
      );
      const canvasWidth = Math.max(1, Math.round(width * ratio));
      const canvasHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        lastFrame.current = -1;
        lastZoom.current = -1;
      }

      const introDistance = Math.max(height * INTRO_DISTANCE_VH, 1_850);
      const holdDistance = Math.max(height * PAGE_HOLD_VH, 145);
      const turnDistance = Math.max(height * PAGE_TURN_VH, 215);
      metricsRef.current = { viewportHeight: height, introDistance, holdDistance, turnDistance };
      const travel = introDistance
        + pageCount * holdDistance
        + Math.max(0, pageCount - 1) * turnDistance;
      section.style.height = `${Math.ceil(height + travel)}px`;

      const sectionTop = window.scrollY + section.getBoundingClientRect().top;
      section.querySelectorAll<HTMLElement>("[data-page-anchor]").forEach((anchor) => {
        const page = Number(anchor.dataset.pageAnchor ?? 0);
        const offset = introDistance + page * (holdDistance + turnDistance) + holdDistance * 0.22;
        anchor.style.top = `${Math.round(offset)}px`;
        anchor.dataset.scrollTop = String(Math.round(sectionTop + offset));
      });
      drawNearest();
    };

    const showFolios = (opacities: Map<number, number>) => {
      foliosRef.current.forEach((folio, index) => {
        if (!folio) return;
        const opacity = clamp(opacities.get(index) ?? 0);
        folio.style.setProperty("--ss-folio-opacity", String(opacity));
        folio.style.visibility = opacity > 0.001 ? "visible" : "hidden";
        folio.style.pointerEvents = opacity > 0.82 ? "auto" : "none";
        const inactive = opacity <= 0.82;
        folio.inert = inactive;
        folio.setAttribute("aria-hidden", String(inactive));
      });
    };

    const setActivePage = (page: number) => {
      if (activePageRef.current === page) return;
      activePageRef.current = page;
      onPageChange(page);
    };

    const setLibraryRevealed = (revealed: boolean) => {
      if (libraryRevealedRef.current === revealed) return;
      libraryRevealedRef.current = revealed;
      onLibraryReveal(revealed);
    };

    const applyProgress = () => {
      const rect = section.getBoundingClientRect();
      const metrics = metricsRef.current;
      const travel = clamp(-rect.top, 0, Math.max(0, section.offsetHeight - metrics.viewportHeight));
      const opacities = new Map<number, number>();
      let frame = 0;
      let zoom = 0;

      if (travel < metrics.introDistance) {
        const progress = clamp(travel / metrics.introDistance);
        frame = Math.round(progress * openingEndIndex);
        zoom = smoothstep(0.035, 0.28, progress);
        opacities.set(0, smoothstep(0.925, 0.985, progress));
        setActivePage(progress >= 0.95 ? 0 : -1);
        setLibraryRevealed(progress >= 0.9);

        beatsRef.current.forEach((beat, index) => {
          if (!beat) return;
          const timing = INTRO_BEATS[index];
          const local = clamp((progress - timing.start) / (timing.end - timing.start));
          const opacity = smoothstep(0, 0.16, local) * (1 - smoothstep(0.78, 1, local));
          beat.style.opacity = String(opacity);
          beat.style.transform = `translate3d(0, ${(0.5 - local) * 52}px, 0)`;
        });
      } else {
        beatsRef.current.forEach((beat) => {
          if (beat) beat.style.opacity = "0";
        });
        setLibraryRevealed(true);
        const afterIntro = travel - metrics.introDistance;
        const cycle = metrics.holdDistance + metrics.turnDistance;
        const page = Math.min(pageCount - 1, Math.floor(afterIntro / cycle));
        const within = afterIntro - page * cycle;

        if (page === pageCount - 1 || within < metrics.holdDistance) {
          frame = page === 0 ? turnStartIndex : frameCount - 1;
          zoom = 1;
          opacities.set(page, 1);
          setActivePage(page);
        } else {
          const phase = clamp((within - metrics.holdDistance) / metrics.turnDistance);
          const turnProgress = smoothstep(0.14, 0.86, phase);
          const restingFrame = page === 0
            ? turnStartIndex
            : frameCount - 1;
          frame = phase < 0.14
            ? restingFrame
            : turnStartIndex
              + Math.round(turnProgress * (turnCount - 1));
          zoom = 1;
          opacities.set(
            page,
            1 - smoothstep(PAGE_OUT_FADE_START, PAGE_OUT_FADE_END, phase),
          );
          opacities.set(
            page + 1,
            smoothstep(PAGE_IN_FADE_START, PAGE_IN_FADE_END, phase),
          );
          setActivePage(phase < 0.5 ? page : page + 1);
        }
      }

      showFolios(opacities);
      targetFrame.current = clamp(frame, 0, frameCount - 1);
      targetZoom.current = zoom;
      warmWindow(targetFrame.current);
      drawNearest();
    };

    const scheduleProgress = () => {
      if (animationFrame.current) return;
      animationFrame.current = window.requestAnimationFrame(() => {
        animationFrame.current = 0;
        applyProgress();
      });
    };

    const handleResize = () => {
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
      resizeTimer.current = window.setTimeout(() => {
        resizeTimer.current = null;
        const pageToPreserve = activePageRef.current;
        sizeExperience();
        if (pageToPreserve >= 0) {
          const metrics = metricsRef.current;
          const sectionTop = window.scrollY + section.getBoundingClientRect().top;
          const offset = metrics.introDistance
            + pageToPreserve * (metrics.holdDistance + metrics.turnDistance)
            + metrics.holdDistance * 0.22;
          scrollWindowInstantly(sectionTop + offset);
        }
        scheduleProgress();
      }, RESIZE_DEBOUNCE_MS);
    };

    const handleHash = () => {
      if (!window.location.hash) return;
      const anchor = document.getElementById(window.location.hash.slice(1));
      if (!(anchor instanceof HTMLElement) || !anchor.dataset.pageAnchor) return;
      const top = Number(anchor.dataset.scrollTop);
      if (Number.isFinite(top)) window.scrollTo({ top, behavior: "smooth" });
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const anchor = document.getElementById("library");
      const top = Number(anchor?.dataset.scrollTop);
      if (Number.isFinite(top)) window.scrollTo({ top, behavior: "smooth" });
    };

    sizeExperience();
    ensureFrame(0);
    ensureFrame(openingEndIndex);
    ensureFrame(frameCount - 1);
    warmWindow(0);
    applyProgress();

    window.addEventListener("scroll", scheduleProgress, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("hashchange", handleHash);
    window.addEventListener("keydown", handleKey);
    window.visualViewport?.addEventListener("resize", handleResize, { passive: true });
    if (window.location.hash) window.setTimeout(handleHash, 80);

    return () => {
      window.removeEventListener("scroll", scheduleProgress);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("hashchange", handleHash);
      window.removeEventListener("keydown", handleKey);
      window.visualViewport?.removeEventListener("resize", handleResize);
      if (animationFrame.current) window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
      cache.forEach((entry) => {
        entry.image.onload = null;
        entry.image.onerror = null;
        entry.image.removeAttribute("src");
      });
      cache.clear();
      folios.forEach((folio) => {
        if (!folio) return;
        folio.inert = false;
        folio.removeAttribute("aria-hidden");
        folio.style.removeProperty("visibility");
        folio.style.removeProperty("pointer-events");
      });
    };
  }, [manifest, onFirstFrameReady, onLibraryReveal, onPageChange, pageCount, reducedMotion, unavailable, variant]);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior = "smooth") => {
    const section = sectionRef.current;
    if (!section) return;
    const bounded = Math.max(0, Math.min(pageCount - 1, page));
    if (reducedMotion || unavailable) {
      const folio = foliosRef.current[bounded];
      if (behavior === "auto" && folio) {
        scrollWindowInstantly(window.scrollY + folio.getBoundingClientRect().top);
      } else {
        folio?.scrollIntoView({ behavior, block: "start" });
      }
      return;
    }
    const metrics = metricsRef.current;
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    const offset = metrics.introDistance
      + bounded * (metrics.holdDistance + metrics.turnDistance)
      + metrics.holdDistance * 0.22;
    if (behavior === "auto") scrollWindowInstantly(sectionTop + offset);
    else window.scrollTo({ top: sectionTop + offset, behavior });
  }, [pageCount, reducedMotion, unavailable]);

  useEffect(() => {
    const preservePage = (event: Event) => {
      const page = (event as CustomEvent<{ page?: number }>).detail?.page;
      if (Number.isFinite(page)) scrollToPage(Number(page), "auto");
    };
    window.addEventListener("ss-library-preserve-page", preservePage);
    return () => window.removeEventListener("ss-library-preserve-page", preservePage);
  }, [scrollToPage]);

  return (
    <section
      ref={sectionRef}
      className={`ss-library-cinematic${reducedMotion || unavailable ? " is-static" : ""}`}
      aria-label="The Story Scrolls library"
    >
      <span id="library" className="ss-deck-anchor" data-page-anchor="0" aria-hidden="true" />
      <span id="featured" className="ss-deck-anchor" data-page-anchor={INTRO_FOLIO_COUNT} aria-hidden="true" />
      <span id="more-curated-classics" className="ss-deck-anchor" data-page-anchor={curatedStartPage} aria-hidden="true" />
      <span id="community-scrolls" className="ss-deck-anchor" data-page-anchor={pageCount - 2} aria-hidden="true" />
      <span id="principles" className="ss-deck-anchor" data-page-anchor={pageCount - 1} aria-hidden="true" />

      <div
        ref={stageRef}
        className={`ss-library-cinematic__stage${zoomLocked ? " is-zoom-locked" : ""}`}
        style={{ "--ss-folio-page-scale": pageScale } as CSSProperties}
      >
        <canvas ref={canvasRef} className="ss-library-cinematic__canvas" aria-hidden="true" />
        <div className="ss-library-intro-copy" aria-hidden="true">
          {INTRO_BEATS.map((beat, index) => (
            <p
              key={beat.copy}
              ref={(element) => { beatsRef.current[index] = element; }}
              className={`ss-library-intro-copy__beat ss-library-intro-copy__beat--${index + 1}`}
            >
              {beat.copy}
            </p>
          ))}
        </div>
        <div className="ss-library-folios">
          {useMemo(() => {
            const items = Array.isArray(children) ? children : [children];
            return items.map((child, index) => (
              <div
                className="ss-library-folio"
                data-page={index}
                key={index}
                ref={(element) => setFolioRef(index, element)}
              >
                {child}
              </div>
            ));
          }, [children, setFolioRef])}
        </div>

        <a
          className="ss-library-skip"
          href="#library"
          onClick={(event) => {
            event.preventDefault();
            scrollToPage(0);
          }}
        >
          Skip introduction
        </a>

        <nav className="ss-library-page-nav" aria-label="Turn library pages">
          <button
            type="button"
            onClick={() => scrollToPage(Math.max(0, activePage - 1))}
            aria-label="Previous library page"
          >
            <span aria-hidden="true">←</span>
          </button>
          <p aria-live="polite">
            <span>{Math.max(1, activePage + 1)} / {pageCount}</span>
            <strong>{pageLabels[Math.max(0, activePage)]}</strong>
          </p>
          <button
            type="button"
            onClick={() => scrollToPage(Math.min(pageCount - 1, activePage + 1))}
            aria-label="Next library page"
          >
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      </div>
    </section>
  );
}

function FeaturedFolioCard({ story }: {
  story: (typeof FEATURED_STORIES)[number];
}) {
  return (
    <a
      className="ss-folio-feature"
      href={story.href}
      data-story-entry
      data-story-title={story.title}
    >
      <div className="ss-folio-feature__art">
        <span className="ss-folio-feature__fallback" aria-hidden="true">
          {story.title.slice(0, 1)}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={story.image}
          alt=""
          loading="lazy"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
        <ImageTextureOverlay source={story.image} />
      </div>
      <div className="ss-folio-feature__body">
        <p>{story.eyebrow}</p>
        <FittedTitle as="h3">{story.title}</FittedTitle>
        <span>by {story.author}</span>
        <small>{story.description}</small>
        <b>{story.format} · Enter →</b>
      </div>
    </a>
  );
}

function CuratedFolioCard({ book }: { book: CuratedLibraryBook }) {
  return (
    <Link
      className="ss-folio-classic"
      href={`/stories/${book.slug}/`}
      data-story-entry
      data-story-title={book.title}
      style={{ "--ss-folio-accent": book.accent } as CSSProperties}
    >
      <div className="ss-folio-classic__cover" aria-hidden="true">
        <span>{book.title.slice(0, 1)}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/assets/library-covers/${book.slug}.webp`}
          alt=""
          loading="lazy"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
        <ImageTextureOverlay source={`/assets/library-covers/${book.slug}.webp`} />
      </div>
      <div>
        <FittedTitle as="h3">{book.title}</FittedTitle>
        <p>by {book.author}</p>
        <small>{book.description}</small>
        <b>{book.expectedChapters} reading sections · Read →</b>
      </div>
    </Link>
  );
}

function CommunityFolio({
  stories,
  state,
}: {
  stories: LibraryStory[];
  state: LibraryEntryExperienceProps["communityState"];
}) {
  return (
    <section className="ss-folio-sheet ss-folio-sheet--community" aria-labelledby="community-folio-title">
      <header className="ss-folio-heading">
        <p className="ss-kicker">From fellow travelers</p>
        <h2 id="community-folio-title" tabIndex={-1}>Community scrolls</h2>
        <p>Stories shared by their creators, with authorship, sources, and permissions kept visible.</p>
      </header>
      <div className="ss-folio-community-grid">
        {state === "loading" ? (
          [0, 1, 2].map((item) => <i className="ss-folio-community-skeleton" key={item} />)
        ) : stories.length ? (
          stories.slice(0, 3).map((story) => (
            <a
              className="ss-folio-community-card"
              href={story.href ?? `/shared/${encodeURIComponent(story.slug)}/`}
              data-story-entry
              data-story-title={story.title}
              key={story.slug}
            >
              <span className={`ss-folio-community-card__art${story.coverUrl ? " has-image" : ""}`} aria-hidden="true">
                <i>{story.title.slice(0, 1)}</i>
                {story.coverUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={story.coverUrl}
                      alt=""
                      loading="lazy"
                      onError={(event) => { event.currentTarget.hidden = true; }}
                    />
                    <ImageTextureOverlay source={story.coverUrl} />
                  </>
                ) : null}
              </span>
              <div>
                <small>Community scroll</small>
                <FittedTitle as="h3">{story.title}</FittedTitle>
                <p>{story.author ? `by ${story.author}` : "Shared by its creator"}</p>
              </div>
            </a>
          ))
        ) : (
          <div className="ss-folio-community-empty">
            <span aria-hidden="true">✦</span>
            <div>
              <h3>{state === "unavailable" ? "The shelf is resting." : "The first shelf is waiting."}</h3>
              <p>Create a public scroll—or keep yours unlisted and share it only with the people you choose.</p>
            </div>
          </div>
        )}
      </div>
      <div className="ss-folio-actions">
        <Link href="/community/">Explore the community</Link>
        <Link href="/create/">Create your own scroll</Link>
      </div>
    </section>
  );
}

export function LibraryEntryExperience({ community, communityState }: LibraryEntryExperienceProps) {
  const assets = useLibrarySequenceAssets();
  const { layout: curatedLayout, preservedStoryHref } = useCuratedFolioLayout();
  const [minimumMet, setMinimumMet] = useState(false);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [firstFrameGraceMet, setFirstFrameGraceMet] = useState(false);
  const [loaderReady, setLoaderReady] = useState(false);
  const [loaderLeaving, setLoaderLeaving] = useState(false);
  const [loaderHidden, setLoaderHidden] = useState(false);
  const [activePage, setActivePage] = useState(-1);
  const [libraryRevealed, setLibraryRevealed] = useState(false);
  const featuredItemsPerPage = curatedLayout.featuredItemsPerPage;
  const featuredGroups = useMemo(
    () => chunkItems(FEATURED_STORIES, featuredItemsPerPage),
    [featuredItemsPerPage],
  );
  const curatedGroups = useMemo(
    () => chunkItems(CURATED_LIBRARY, curatedLayout.itemsPerPage),
    [curatedLayout.itemsPerPage],
  );
  const previousPagination = useRef({
    itemsPerPage: curatedLayout.itemsPerPage,
    featuredItemsPerPage,
    featuredGroupCount: featuredGroups.length,
    curatedGroupCount: curatedGroups.length,
  });
  const pageLabels = useMemo(
    () => [
      "What Story Scrolls does",
      "Why stories matter",
      ...featuredGroups.map((group) => (
        group.length > 1 ? "Wonderland & Oz" : group[0]?.title ?? "Illustrated classic"
      )),
      ...curatedGroups.map((_, index) => `Curated classics · ${index + 1}`),
      "Community scrolls",
      "Our principles",
    ],
    [curatedGroups, featuredGroups],
  );
  const pageCount = pageLabels.length;

  useEffect(() => {
    const previous = previousPagination.current;
    const nextFeaturedGroupCount = featuredGroups.length;
    const nextGroupCount = curatedGroups.length;
    const paginationChanged = previous.itemsPerPage !== curatedLayout.itemsPerPage
      || previous.featuredItemsPerPage !== featuredItemsPerPage
      || previous.featuredGroupCount !== nextFeaturedGroupCount
      || previous.curatedGroupCount !== nextGroupCount;
    if (!paginationChanged) return;

    const mappedPage = (() => {
      const current = activePage;
      if (current < INTRO_FOLIO_COUNT) return Math.min(current, pageCount - 1);

      const previousCuratedStart = INTRO_FOLIO_COUNT + previous.featuredGroupCount;
      const nextCuratedStart = INTRO_FOLIO_COUNT + nextFeaturedGroupCount;
      if (current < previousCuratedStart) {
        const firstVisibleFeature = (current - INTRO_FOLIO_COUNT) * previous.featuredItemsPerPage;
        return INTRO_FOLIO_COUNT + Math.floor(firstVisibleFeature / featuredItemsPerPage);
      }

      const previousCommunityPage = previousCuratedStart + previous.curatedGroupCount;
      const previousPrinciplesPage = previousCommunityPage + 1;
      if (current === previousCommunityPage) return nextCuratedStart + nextGroupCount;
      if (current === previousPrinciplesPage) return nextCuratedStart + nextGroupCount + 1;

      const firstVisibleBook = (current - previousCuratedStart) * previous.itemsPerPage;
      const correspondingPage = nextCuratedStart
        + Math.floor(firstVisibleBook / curatedLayout.itemsPerPage);
      return Math.min(correspondingPage, pageCount - 1);
    })();

    previousPagination.current = {
      itemsPerPage: curatedLayout.itemsPerPage,
      featuredItemsPerPage,
      featuredGroupCount: nextFeaturedGroupCount,
      curatedGroupCount: nextGroupCount,
    };

    if (mappedPage >= 0 || preservedStoryHref.current) {
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          const preservedLink = preservedStoryHref.current
            ? Array.from(document.querySelectorAll<HTMLAnchorElement>(
                '.ss-library-folio a[href^="/stories/"]',
              )).find((link) => link.getAttribute("href") === preservedStoryHref.current)
            : null;
          const preservedPage = Number(
            preservedLink?.closest<HTMLElement>(".ss-library-folio")?.dataset.page,
          );
          const targetPage = Number.isFinite(preservedPage) ? preservedPage : mappedPage;
          preservedStoryHref.current = null;
          if (targetPage < 0) return;
          window.dispatchEvent(new CustomEvent("ss-library-preserve-page", {
            detail: { page: targetPage },
          }));
        });
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }
  }, [activePage, curatedGroups.length, curatedLayout.itemsPerPage, featuredGroups.length, featuredItemsPerPage, pageCount, preservedStoryHref]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumMet(true), LOADER_MINIMUM_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("ss-entry-locked");
    document.body.classList.add("ss-entry-locked");
    if (window.scrollY > 0 && !window.location.hash) window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove("ss-entry-locked");
      document.body.classList.remove("ss-entry-locked");
    };
  }, []);

  useEffect(() => {
    if (!assets.ready || firstFrameReady || assets.reducedMotion || assets.unavailable) return;
    const timer = window.setTimeout(() => setFirstFrameGraceMet(true), FIRST_FRAME_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [assets.ready, assets.reducedMotion, assets.unavailable, firstFrameReady]);

  const stageCanOpen = firstFrameReady
    || firstFrameGraceMet
    || assets.reducedMotion
    || assets.unavailable;
  const loaderProgress = clamp(assets.progress * 0.96 + (stageCanOpen ? 0.04 : 0));

  useEffect(() => {
    if (!minimumMet || !assets.ready || !stageCanOpen || loaderReady) return;
    const timer = window.setTimeout(() => setLoaderReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [assets.ready, loaderReady, minimumMet, stageCanOpen]);

  useEffect(() => {
    if (!loaderLeaving) return;
    document.documentElement.classList.remove("ss-entry-locked");
    document.body.classList.remove("ss-entry-locked");
    const timer = window.setTimeout(() => setLoaderHidden(true), LOADER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [loaderLeaving]);

  useEffect(() => {
    if (!loaderHidden || !window.location.hash) return;
    const anchor = document.getElementById(window.location.hash.slice(1));
    const top = Number(anchor?.dataset.scrollTop);
    if (!Number.isFinite(top)) return;
    const timer = window.setTimeout(() => window.scrollTo({ top, behavior: "auto" }), 0);
    return () => window.clearTimeout(timer);
  }, [loaderHidden]);

  const folios = useMemo(() => [
    <section className="ss-folio-sheet ss-folio-sheet--intro" aria-labelledby="library-folio-title" key="what-story-scrolls-does">
      <div className="ss-folio-intro__copy">
        <p className="ss-kicker">The Story Scrolls</p>
        <h1 id="library-folio-title" tabIndex={-1}>Books become living scrolls.</h1>
        <p className="ss-folio-intro__lead">
          Classic books and stories you create become flowing, illustrated journeys—complete,
          condensed, adapted for a reader’s age, or told entirely in pictures.
        </p>
        <p className="ss-folio-intro__aside">Read one now. Or learn by making your own.</p>
        <p className="ss-folio-turn-cue">
          <span aria-hidden="true">↓</span>
          {assets.reducedMotion || assets.unavailable ? "Continue below" : "Turn the page"}
        </p>
      </div>
      <figure className="ss-folio-intro__art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/library-intro/reading-across-generations.webp"
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <ImageTextureOverlay source="/assets/library-intro/reading-across-generations.webp" fit="cover" />
      </figure>
    </section>,
    <section className="ss-folio-sheet ss-folio-sheet--intro ss-folio-sheet--intro-reverse" aria-labelledby="why-story-scrolls-title" key="why-story-scrolls-exists">
      <div className="ss-folio-intro__copy">
        <p className="ss-kicker">Why we built it</p>
        <h2 id="why-story-scrolls-title" tabIndex={-1}>A first spark. A lifelong love.</h2>
        <p className="ss-folio-intro__lead">
          Clearer words and richer pictures welcome young readers. Familiar books feel new
          again for older ones.
        </p>
        <p className="ss-folio-intro__aside">
          Creating a scroll teaches the building blocks of writing: character, goal,
          obstacle, consequence, and change.
        </p>
        <p className="ss-folio-turn-cue">
          <span aria-hidden="true">↓</span>
          {assets.reducedMotion || assets.unavailable ? "Meet the library below" : "Find your first story"}
        </p>
      </div>
      <figure className="ss-folio-intro__art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/library-intro/learning-to-shape-stories.webp"
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <ImageTextureOverlay source="/assets/library-intro/learning-to-shape-stories.webp" fit="cover" />
      </figure>
    </section>,
    ...featuredGroups.map((group, groupIndex) => (
      <section
        className="ss-folio-sheet"
        aria-labelledby={`featured-classics-folio-${groupIndex}`}
        key={`featured-classics-${groupIndex}`}
      >
        <header className="ss-folio-heading">
          <p className="ss-kicker">Illustrated classics</p>
          <h2 id={`featured-classics-folio-${groupIndex}`} tabIndex={-1}>
            {group.length > 1
              ? "Down the rabbit hole. Over the rainbow."
              : group[0]?.slug === "alice-in-wonderland"
                ? "Down the rabbit hole."
                : "Over the rainbow."}
          </h2>
        </header>
        <div className="ss-folio-feature-grid">
          {group.map((story) => <FeaturedFolioCard story={story} key={story.slug} />)}
        </div>
      </section>
    )),
    ...curatedGroups.map((group, groupIndex) => (
      <section
        className="ss-folio-sheet ss-folio-sheet--classics"
        aria-labelledby={`classics-folio-${groupIndex}`}
        key={`classics-${groupIndex}`}
        style={{
          "--ss-folio-columns": curatedLayout.columns,
          "--ss-folio-rows": Math.ceil(group.length / curatedLayout.columns),
        } as CSSProperties}
      >
        <header className="ss-folio-heading ss-folio-heading--compact">
          <p className="ss-kicker">The endless shelf · folio {groupIndex + 1} of {curatedGroups.length}</p>
          <h2 id={`classics-folio-${groupIndex}`} tabIndex={-1}>
            {groupIndex === 0 ? "Beloved worlds, newly unfurled." : "More beloved worlds, ready to unfold."}
          </h2>
        </header>
        <div className="ss-folio-classic-grid">
          {group.map((book) => <CuratedFolioCard book={book} key={book.slug} />)}
        </div>
      </section>
    )),
    <CommunityFolio stories={community} state={communityState} key="community" />,
    <section className="ss-folio-sheet ss-folio-sheet--principles" aria-labelledby="principles-folio-title" key="principles">
      <header className="ss-folio-heading">
        <p className="ss-kicker">A library with a conscience</p>
        <h2 id="principles-folio-title" tabIndex={-1}>Beautiful should also mean responsible.</h2>
      </header>
      <div className="ss-folio-principles-grid">
        <article><span>01</span><h3>Sources stay visible</h3><p>Authors, artists, editions, licenses, and original links travel with every scroll.</p></article>
        <article><span>02</span><h3>Sharing is intentional</h3><p>You choose the audience. Public stories pass rights checks and focused safety review.</p></article>
        <article><span>03</span><h3>Your key stays yours</h3><p>Creation uses the OpenAI key you provide for that request. It is never saved.</p></article>
      </div>
      <div className="ss-folio-actions">
        <Link href="/community/">Explore the library</Link>
        <Link href="/create/">Create a Scroll</Link>
      </div>
    </section>,
  ], [assets.reducedMotion, assets.unavailable, community, communityState, curatedGroups, curatedLayout.columns, featuredGroups]);

  const handleFirstFrameReady = useCallback(() => setFirstFrameReady(true), []);
  const handleLoaderComplete = useCallback(() => setLoaderLeaving(true), []);

  return (
    <main className={`ss-platform ss-platform--cinematic${libraryRevealed ? " is-library-open" : ""}${assets.reducedMotion || assets.unavailable ? " is-static-library" : ""}`}>
      <PlatformHeader />
      {!loaderHidden ? (
        <LibraryLoader
          progress={loaderProgress}
          failed={assets.failed}
          ready={loaderReady}
          reducedMotion={assets.reducedMotion}
          leaving={loaderLeaving}
          onComplete={handleLoaderComplete}
        />
      ) : null}
      <LibraryCinematicStage
        manifest={assets.manifest}
        variant={assets.variant}
        reducedMotion={assets.reducedMotion}
        unavailable={assets.unavailable}
        onFirstFrameReady={handleFirstFrameReady}
        onPageChange={setActivePage}
        onLibraryReveal={setLibraryRevealed}
        activePage={activePage}
        pageCount={pageCount}
        curatedStartPage={INTRO_FOLIO_COUNT + featuredGroups.length}
        pageLabels={pageLabels}
        pageScale={curatedLayout.pageScale}
        zoomLocked={curatedLayout.zoomLocked}
      >
        {folios}
      </LibraryCinematicStage>
      <PlatformFooter />
      <p className="sr-only" aria-live="polite">
        {activePage >= 0 ? `Library page ${activePage + 1} of ${pageCount}: ${pageLabels[activePage]}` : "Illustrated introduction"}
      </p>
      <noscript>
        <style>{`.ss-library-loader{display:none!important}.ss-header{position:relative!important}.ss-library-folios{display:block!important}`}</style>
      </noscript>
    </main>
  );
}

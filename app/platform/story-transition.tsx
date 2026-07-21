"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  destinationTextureGeometry,
  handoffTextureGeometry,
} from "./story-transition-geometry.mjs";

const LIBRARY_MANIFEST_URL = "/assets/library-intro/manifest.json";
const SCROLL_ENTRY_MANIFEST_URL = "/assets/scroll-entry/manifest.json";
const ARRIVAL_STORAGE_KEY = "storyscrolls:story-transition-arrival";
const ARRIVAL_READY_EVENT = "storyscrolls:story-transition-ready";
const ARRIVAL_MARKER_EVENT = "storyscrolls:story-transition-marker";
const ARRIVAL_MAX_AGE_MS = 2 * 60_000;

const FRAME_CACHE_LIMIT = 12;
const FRAME_LOOKAHEAD = 8;
const CANVAS_PIXEL_BUDGET = 4_500_000;
const FOLIO_FADE_MS = 280;
const BOOK_TURN_MS = 1_350;
const BLANK_HOLD_MS = 280;
const BLANK_DISSOLVE_MS = 160;
const HANDOFF_FRAME_WAIT_MS = 900;
const DESTINATION_READY_TIMEOUT_MS = 15_000;
const DESTINATION_SETTLE_MS = 160;
const DESTINATION_SCROLL_MS = 1_120;
const FADE_REVEAL_MS = 960;

type TransitionPhase =
  | "idle"
  | "folio-out"
  | "book-turn"
  | "blank-hold"
  | "scroll-entry"
  | "handoff"
  | "routing"
  | "revealing";

type SequenceVariant = {
  id: string;
  width: number;
  height: number;
  quality?: number;
  basePath: string;
  filePattern: string;
  bytes?: number;
};

type SequenceManifest = {
  version: number;
  source?: {
    count?: number;
    fps?: number;
    effectiveFps?: number;
    width?: number;
    height?: number;
  };
  frames: {
    count: number;
    openingEndIndex?: number;
    turnStartIndex?: number;
    turnCount?: number;
    filePattern?: string;
    sourceFrameIndexes?: number[];
    phases?: {
      bookHold?: { startIndex: number; endIndex: number };
      pageTurn?: { startIndex: number; endIndex: number };
      scrollReveal?: { startIndex: number; endIndex: number };
      parchmentHandoff?: { startIndex: number; endIndex: number };
    };
  };
  variants: SequenceVariant[];
  handoff?: {
    startIndex?: number;
    endIndex?: number;
    parchmentScale?: number;
    sequenceExposure?: { start: number; end: number };
    bridgeSourceYOffsetRatio?: number;
    bridgeVariants?: Array<{
      id: string;
      width: number;
      height: number;
      url: string;
      bytes?: number;
    }>;
  };
};

type DecodedFrame = {
  id: string;
  index: number;
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
  touched: number;
};

type ArrivalMarker = {
  href: string;
  label: string;
  createdAt: number;
  phase: "routing";
};

type PendingDestination = {
  href: string;
  label: string;
};

type ReadyEventDetail = {
  href?: string;
  textureGeometry?: ParchmentGeometry;
  surfaceTarget?: HTMLElement | null;
  spacerTarget?: HTMLElement | null;
  revealMode?: "scroll" | "fade";
  focusTarget?: HTMLElement | null;
};

type ParchmentGeometry = {
  width: number;
  left: number;
  top: number;
};

function measureDestinationTexture(surface: HTMLElement | null | undefined) {
  if (!surface?.isConnected) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const style = window.getComputedStyle(surface);
  const minimumTextureWidth = Number.parseFloat(
    style.getPropertyValue("--ss-story-paper-texture-min-width"),
  );
  return destinationTextureGeometry({
    surfaceWidth: surfaceRect.width,
    surfaceTop: surfaceRect.top,
    minimumWidth: Number.isFinite(minimumTextureWidth) ? minimumTextureWidth : 1000,
  });
}

function alignSurfaceTextureToHandoff(
  surface: HTMLElement | null | undefined,
  geometry: ParchmentGeometry,
) {
  if (!surface?.isConnected) return;
  const surfaceRect = surface.getBoundingClientRect();
  surface.style.setProperty("--ss-story-paper-transition-size", `${geometry.width}px auto`);
  surface.style.setProperty(
    "--ss-story-paper-transition-position",
    `${geometry.left - surfaceRect.left}px ${geometry.top - surfaceRect.top}px`,
  );
}

export type StoryTransitionArrivalOptions = {
  /** Signal only after the destination parchment and its first readable content exist. */
  ready: boolean;
  /** The element carrying the endless parchment background. */
  targetRef?: RefObject<HTMLElement | null>;
  /** @deprecated Use targetRef. Kept as an integration-friendly alias. */
  surfaceRef?: RefObject<HTMLElement | null>;
  /** Optional destination heading or reading landmark to receive focus after reveal. */
  focusRef?: RefObject<HTMLElement | null>;
  /** Blank lead-in measured for the real document-scroll arrival. */
  spacerRef?: RefObject<HTMLElement | null>;
  /** Use a simple crossfade for a story that owns its own cinematic intro. */
  revealMode?: "scroll" | "fade";
};

type TransitionContextValue = {
  active: boolean;
  phase: TransitionPhase;
};

const TransitionContext = createContext<TransitionContextValue>({
  active: false,
  phase: "idle",
});

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(start: number, end: number, value: number) {
  if (start === end) return value < start ? 0 : 1;
  const amount = clamp((value - start) / (end - start));
  return amount * amount * (3 - 2 * amount);
}

function frameFilename(pattern: string, index: number) {
  return pattern
    .replace("{index:000}", String(index).padStart(3, "0"))
    .replace("{index}", String(index));
}

function frameUrl(manifest: SequenceManifest, variant: SequenceVariant, index: number) {
  const pattern = variant.filePattern || manifest.frames.filePattern || "frame-{index:000}.webp";
  return `${variant.basePath}/${frameFilename(pattern, index)}`;
}

function selectVariant(manifest: SequenceManifest) {
  const density = Math.min(window.devicePixelRatio || 1, 1.5);
  const targetWidth = Math.max(window.innerWidth, Math.round(window.innerWidth * density));
  const variants = [...manifest.variants].sort((left, right) => left.width - right.width);
  return variants.find((variant) => variant.width >= targetWidth) ?? variants.at(-1) ?? null;
}

function isSequenceManifest(value: unknown): value is SequenceManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SequenceManifest>;
  return Boolean(
    candidate.frames
      && Number.isFinite(candidate.frames.count)
      && candidate.frames.count > 0
      && Array.isArray(candidate.variants)
      && candidate.variants.length,
  );
}

async function fetchManifest(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Transition manifest failed (${response.status})`);
  const manifest = await response.json() as unknown;
  if (!isSequenceManifest(manifest)) throw new Error("Transition manifest was not recognized.");
  return manifest;
}

function destinationFromAnchor(anchor: HTMLAnchorElement) {
  if (anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target.toLowerCase() !== "_self") return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!/^\/(?:stories|shared)\//.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

function routeKey(value: string | URL) {
  try {
    const url = value instanceof URL ? value : new URL(value, window.location.origin);
    return `${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return "";
  }
}

function readArrivalMarker() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(ARRIVAL_STORAGE_KEY);
    if (!value) return null;
    const marker = JSON.parse(value) as ArrivalMarker;
    if (
      marker?.phase !== "routing"
      || typeof marker.href !== "string"
      || !Number.isFinite(marker.createdAt)
      || Date.now() - marker.createdAt > ARRIVAL_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(ARRIVAL_STORAGE_KEY);
      return null;
    }
    return marker;
  } catch {
    return null;
  }
}

function writeArrivalMarker(destination: PendingDestination) {
  try {
    const marker: ArrivalMarker = {
      ...destination,
      createdAt: Date.now(),
      phase: "routing",
    };
    window.sessionStorage.setItem(ARRIVAL_STORAGE_KEY, JSON.stringify(marker));
    window.dispatchEvent(new Event(ARRIVAL_MARKER_EVENT));
  } catch {
    // The in-memory provider still completes the same-tab handoff when storage is unavailable.
  }
}

function clearArrivalMarker() {
  try {
    window.sessionStorage.removeItem(ARRIVAL_STORAGE_KEY);
    window.dispatchEvent(new Event(ARRIVAL_MARKER_EVENT));
  } catch {
    // Storage is an optional resilience layer.
  }
}

function currentRouteMatches(href: string) {
  if (typeof window === "undefined") return false;
  return routeKey(window.location.href) === routeKey(href);
}

function drawCover(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
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

function sourceMappedFrame(manifest: SequenceManifest, progress: number) {
  const mapping = manifest.frames.sourceFrameIndexes;
  if (!mapping?.length) return Math.round(clamp(progress) * (manifest.frames.count - 1));
  const first = mapping[0];
  const last = mapping.at(-1) ?? first;
  const target = first + clamp(progress) * (last - first);
  let lower = 0;
  let upper = mapping.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (mapping[middle] < target) lower = middle + 1;
    else upper = middle;
  }
  if (lower > 0 && Math.abs(mapping[lower - 1] - target) <= Math.abs(mapping[lower] - target)) {
    return lower - 1;
  }
  return lower;
}

function sequenceDuration(manifest: SequenceManifest) {
  const fps = manifest.source?.fps || manifest.source?.effectiveFps || 30;
  const mapping = manifest.frames.sourceFrameIndexes;
  if (mapping?.length && mapping.length > 1) {
    return Math.max(1_000, ((mapping.at(-1)! - mapping[0]) / fps) * 1_000);
  }
  const sourceCount = manifest.source?.count || manifest.frames.count;
  return Math.max(1_000, ((sourceCount - 1) / fps) * 1_000);
}

function connectionPrefersLessData() {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return Boolean(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? ""));
}

async function warmSequence(
  manifest: SequenceManifest,
  signal: AbortSignal,
  concurrency = 3,
) {
  const variant = selectVariant(manifest);
  if (!variant) return;
  const urls = Array.from(
    { length: manifest.frames.count },
    (_, index) => frameUrl(manifest, variant, index),
  );
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= urls.length) return;
      try {
        const response = await fetch(urls[index], {
          cache: "force-cache",
          credentials: "same-origin",
          signal,
        });
        if (response.ok) await response.blob();
      } catch {
        if (signal.aborted) return;
      }
    }
  });
  await Promise.all(workers);
}

/**
 * Returns true only for an unexpired catalog-to-reader arrival. When `ready`
 * becomes true, the hook waits for two paints and tells the persistent provider
 * it is safe to reveal the destination.
 */
export function useStoryTransitionArrival({
  ready,
  targetRef,
  surfaceRef,
  focusRef,
  spacerRef,
  revealMode = "scroll",
}: StoryTransitionArrivalOptions) {
  const signaledRef = useRef(false);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("pageshow", notify);
    window.addEventListener("popstate", notify);
    window.addEventListener("storage", notify);
    window.addEventListener(ARRIVAL_MARKER_EVENT, notify);
    return () => {
      window.removeEventListener("pageshow", notify);
      window.removeEventListener("popstate", notify);
      window.removeEventListener("storage", notify);
      window.removeEventListener(ARRIVAL_MARKER_EVENT, notify);
    };
  }, []);
  const isArrival = useSyncExternalStore(
    subscribe,
    () => {
      const marker = readArrivalMarker();
      return Boolean(marker && currentRouteMatches(marker.href));
    },
    () => false,
  );

  useEffect(() => {
    if (!isArrival) {
      signaledRef.current = false;
      return;
    }
    if (!ready || signaledRef.current) return;
    let secondFrame = 0;
    const surface = targetRef?.current ?? surfaceRef?.current ?? null;
    const spacer = spacerRef?.current ?? null;
    // A catalog arrival begins one viewport before the parchment. Keep the
    // document at its true starting position; the reveal collapses that blank
    // lead-in so the whole paper moves in the same direction as normal reading.
    spacer?.style.removeProperty("--ss-story-arrival-height");
    const startY = spacer
      ? window.scrollY + spacer.getBoundingClientRect().top
      : 0;
    window.scrollTo({ top: Math.max(0, startY), left: 0, behavior: "auto" });
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (signaledRef.current) return;
        signaledRef.current = true;
        const detail: ReadyEventDetail = {
          href: window.location.href,
          textureGeometry: measureDestinationTexture(surface) ?? undefined,
          surfaceTarget: surface,
          spacerTarget: spacer,
          revealMode,
          focusTarget: focusRef?.current ?? null,
        };
        window.dispatchEvent(new CustomEvent<ReadyEventDetail>(ARRIVAL_READY_EVENT, { detail }));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [focusRef, isArrival, ready, revealMode, spacerRef, surfaceRef, targetRef]);

  return isArrival;
}

export function useStoryTransitionState() {
  return useContext(TransitionContext);
}

export function StoryTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [status, setStatus] = useState("Opening the chosen story…");
  const [libraryManifest, setLibraryManifest] = useState<SequenceManifest | null>(null);
  const [entryManifest, setEntryManifest] = useState<SequenceManifest | null>(null);

  const phaseRef = useRef<TransitionPhase>("idle");
  const destinationRef = useRef<PendingDestination | null>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const bookCanvasRef = useRef<HTMLCanvasElement>(null);
  const entryCanvasRef = useRef<HTMLCanvasElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const animationFrameRef = useRef(0);
  const routeTimerRef = useRef(0);
  const touchCounterRef = useRef(0);
  const frameCacheRef = useRef(new Map<string, DecodedFrame>());
  const selectedVariantsRef = useRef<{
    book: SequenceVariant | null;
    entry: SequenceVariant | null;
  }>({ book: null, entry: null });
  const inertRecordsRef = useRef(new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>());
  const inertObserverRef = useRef<MutationObserver | null>(null);
  const focusedBeforeRef = useRef<HTMLElement | null>(null);
  const arrivalDetailRef = useRef<ReadyEventDetail | null>(null);
  const skipRequestedRef = useRef(false);
  const bookPaintedRef = useRef(false);
  const entryPaintedRef = useRef(false);
  const entryHandoffPaintedRef = useRef(false);
  const handoffGeometryRef = useRef<ParchmentGeometry | null>(null);

  const commitPhase = useCallback((next: TransitionPhase) => {
    phaseRef.current = next;
    setPhase(next);
    const root = document.documentElement;
    root.dataset.storyTransitionPhase = next;
  }, []);

  const setVisualOpacity = useCallback((
    book: number,
    entry: number,
  ) => {
    const boundedBook = clamp(book);
    const boundedEntry = clamp(entry);
    if (bookCanvasRef.current) bookCanvasRef.current.style.opacity = String(boundedBook);
    if (entryCanvasRef.current) entryCanvasRef.current.style.opacity = String(boundedEntry);
    overlayRef.current?.style.setProperty("--ss-transition-book-opacity", String(boundedBook));
    overlayRef.current?.style.setProperty("--ss-transition-entry-opacity", String(boundedEntry));
  }, []);

  const setEntryExposure = useCallback((value: number) => {
    if (!entryCanvasRef.current) return;
    entryCanvasRef.current.style.filter = `brightness(${clamp(value, 0.75, 1.1)})`;
  }, []);

  const setHandoffOpacity = useCallback((opacity: number) => {
    const boundedOpacity = clamp(opacity);
    if (entryHandoffPaintedRef.current) {
      // Successful arrivals hold only the exact final video frame. The live
      // page is revealed directly beneath it; an intermediate parchment plate
      // would create a full-screen tan beat even when all textures align.
      setVisualOpacity(0, boundedOpacity);
      return;
    }
    // Recovery arrivals (reload, reduced motion, early skip, or a decode
    // failure) have no trustworthy final frame to align. Reveal the real route
    // directly instead of manufacturing a full-screen parchment interstitial.
    setVisualOpacity(0, 0);
  }, [setVisualOpacity]);

  const clearParchmentReveal = useCallback(() => {
    for (const cover of [entryCanvasRef.current]) {
      if (!cover) continue;
      cover.style.removeProperty("transform");
      cover.style.removeProperty("mask-image");
      cover.style.removeProperty("-webkit-mask-image");
    }
  }, []);

  const setParchmentRevealEdge = useCallback((edge: number, feather: number) => {
    const safeEdge = Number.isFinite(edge) ? edge : window.innerHeight;
    const safeFeather = Math.max(1, Number.isFinite(feather) ? feather : 64);
    // Keep the final video frame fixed in screen space while the live paper is
    // phase-locked beneath it. Moving this bitmap would move its texture sample
    // away from the otherwise identical live background and recreate a seam.
    const coverMask = `linear-gradient(to bottom, #000 0, #000 ${safeEdge}px, `
      + `transparent ${safeEdge + safeFeather}px, transparent 100%)`;
    for (const cover of [entryCanvasRef.current]) {
      if (!cover) continue;
      cover.style.removeProperty("transform");
      cover.style.setProperty("mask-image", coverMask);
      cover.style.setProperty("-webkit-mask-image", coverMask);
    }
  }, []);

  const sizeCanvases = useCallback(() => {
    const rootRect = document.documentElement.getBoundingClientRect();
    const cssWidth = Math.max(
      1,
      rootRect.width || window.visualViewport?.width || window.innerWidth,
    );
    const cssHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      1.75,
      Math.sqrt(CANVAS_PIXEL_BUDGET / (cssWidth * cssHeight)),
    );
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    const handoffGeometry = handoffTextureGeometry({
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
      viewportLeft: rootRect.left,
      viewportTop: 0,
      parchmentScale: entryManifest?.handoff?.parchmentScale ?? 1.2,
      sourceYOffsetRatio: entryManifest?.handoff?.bridgeSourceYOffsetRatio ?? 0.4270833333,
    });
    handoffGeometryRef.current = handoffGeometry;
    for (const canvas of [bookCanvasRef.current, entryCanvasRef.current]) {
      if (!canvas || (canvas.width === width && canvas.height === height)) continue;
      // CSS can safely scale an already-painted frame during a mid-transition
      // resize. Reallocating the visible bitmap would clear it to black.
      if (phaseRef.current !== "idle" && canvas.width > 0 && canvas.height > 0) continue;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (context) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
      }
    }
  }, [entryManifest]);

  const evictFrames = useCallback((protectedIds: Set<string>) => {
    const cache = frameCacheRef.current;
    if (cache.size <= FRAME_CACHE_LIMIT) return;
    const candidates = [...cache.values()]
      .filter((entry) => !protectedIds.has(entry.id))
      .sort((left, right) => left.touched - right.touched);
    while (cache.size > FRAME_CACHE_LIMIT && candidates.length) {
      const entry = candidates.shift()!;
      cache.delete(entry.id);
      entry.image.onload = null;
      entry.image.onerror = null;
      entry.image.removeAttribute("src");
    }
  }, []);

  const ensureDecodedFrame = useCallback((
    id: "book" | "entry",
    manifest: SequenceManifest,
    variant: SequenceVariant,
    index: number,
  ) => {
    if (index < 0 || index >= manifest.frames.count) return null;
    const key = `${id}:${variant.id}:${index}`;
    const cache = frameCacheRef.current;
    const existing = cache.get(key);
    if (existing) {
      existing.touched = ++touchCounterRef.current;
      return existing;
    }
    const image = new Image();
    const entry: DecodedFrame = {
      id: key,
      index,
      image,
      ready: false,
      failed: false,
      touched: ++touchCounterRef.current,
    };
    cache.set(key, entry);
    image.decoding = "async";
    image.onload = () => {
      entry.ready = true;
      entry.touched = ++touchCounterRef.current;
    };
    image.onerror = () => {
      entry.failed = true;
      entry.touched = ++touchCounterRef.current;
    };
    image.src = frameUrl(manifest, variant, index);
    return entry;
  }, []);

  const drawSequence = useCallback((
    canvas: HTMLCanvasElement | null,
    id: "book" | "entry",
    manifest: SequenceManifest,
    variant: SequenceVariant,
    requestedIndex: number,
    requireExact = false,
  ) => {
    if (!canvas) return false;
    const index = Math.max(0, Math.min(manifest.frames.count - 1, Math.round(requestedIndex)));
    const protectedIds = new Set<string>();
    for (let offset = -2; offset <= FRAME_LOOKAHEAD; offset += 1) {
      const entry = ensureDecodedFrame(id, manifest, variant, index + offset);
      if (entry) protectedIds.add(entry.id);
    }
    evictFrames(protectedIds);

    const exactKey = `${id}:${variant.id}:${index}`;
    let frame = frameCacheRef.current.get(exactKey);
    if (!frame?.ready && !requireExact) {
      frame = undefined;
      for (let distance = 1; distance <= 6 && !frame; distance += 1) {
        const prior = frameCacheRef.current.get(`${id}:${variant.id}:${index - distance}`);
        const next = frameCacheRef.current.get(`${id}:${variant.id}:${index + distance}`);
        frame = prior?.ready ? prior : next?.ready ? next : undefined;
      }
    }
    if (!frame?.ready) return false;
    frame.touched = ++touchCounterRef.current;
    drawCover(canvas, frame.image);
    return true;
  }, [ensureDecodedFrame, evictFrames]);

  useEffect(() => {
    if (!libraryManifest || !entryManifest) return;
    const bookVariant = selectVariant(libraryManifest);
    const scrollVariant = selectVariant(entryManifest);
    if (!bookVariant || !scrollVariant) return;
    const bookStart = Math.max(0, libraryManifest.frames.turnStartIndex ?? 195);
    const bookEnd = Math.min(
      libraryManifest.frames.count - 1,
      bookStart + Math.max(1, libraryManifest.frames.turnCount ?? 68) - 1,
    );
    ensureDecodedFrame("book", libraryManifest, bookVariant, bookStart);
    ensureDecodedFrame("book", libraryManifest, bookVariant, bookEnd);
    ensureDecodedFrame("entry", entryManifest, scrollVariant, 0);
    ensureDecodedFrame("entry", entryManifest, scrollVariant, entryManifest.frames.count - 1);
  }, [ensureDecodedFrame, entryManifest, libraryManifest]);

  const restoreInertContent = useCallback(() => {
    inertObserverRef.current?.disconnect();
    inertObserverRef.current = null;
    inertRecordsRef.current.forEach((previous, element) => {
      if (!element.isConnected) return;
      element.inert = previous.inert;
      if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", previous.ariaHidden);
    });
    inertRecordsRef.current.clear();
  }, []);

  const activateContentTransition = useCallback(() => {
    document.documentElement.classList.add("ss-story-transition-active");
    document.body.classList.add("ss-story-transition-active");
  }, []);

  const lockContent = useCallback(() => {
    const makeInert = () => {
      document.querySelectorAll<HTMLElement>("body main").forEach((element) => {
        if (element.closest(".ss-story-transition")) return;
        if (!inertRecordsRef.current.has(element)) {
          inertRecordsRef.current.set(element, {
            inert: element.inert,
            ariaHidden: element.getAttribute("aria-hidden"),
          });
        }
        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      });
    };
    activateContentTransition();
    document.documentElement.classList.add("ss-story-transition-locked");
    document.body.classList.add("ss-story-transition-locked");
    makeInert();
    inertObserverRef.current?.disconnect();
    inertObserverRef.current = new MutationObserver(makeInert);
    inertObserverRef.current.observe(document.body, { childList: true, subtree: true });
  }, [activateContentTransition]);

  const unlockContent = useCallback(() => {
    document.documentElement.classList.remove("ss-story-transition-active");
    document.body.classList.remove("ss-story-transition-active");
    document.documentElement.classList.remove("ss-story-transition-locked");
    document.body.classList.remove("ss-story-transition-locked");
    document.documentElement.removeAttribute("data-story-transition-phase");
    restoreInertContent();
  }, [restoreInertContent]);

  const cancelTransition = useCallback(() => {
    const spacer = arrivalDetailRef.current?.spacerTarget;
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = 0;
    setVisualOpacity(0, 0);
    setEntryExposure(1);
    clearParchmentReveal();
    clearArrivalMarker();
    arrivalDetailRef.current = null;
    skipRequestedRef.current = false;
    bookPaintedRef.current = false;
    entryPaintedRef.current = false;
    entryHandoffPaintedRef.current = false;
    destinationRef.current = null;
    commitPhase("idle");
    unlockContent();
    spacer?.style.removeProperty("--ss-story-arrival-height");
    const previousFocus = focusedBeforeRef.current;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, [clearParchmentReveal, commitPhase, setEntryExposure, setVisualOpacity, unlockContent]);

  const finishReveal = useCallback((detail?: ReadyEventDetail, immediate = false) => {
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = 0;
    commitPhase("revealing");
    if (detail) arrivalDetailRef.current = detail;
    const arrival = detail ?? arrivalDetailRef.current;
    setStatus("Unrolling the first page…");
    clearParchmentReveal();
    const revealFromEntryFrame = entryHandoffPaintedRef.current;
    const setRevealCoverOpacity = (opacity: number) => {
      const boundedOpacity = clamp(opacity);
      if (revealFromEntryFrame) {
        setVisualOpacity(0, boundedOpacity);
      }
      else {
        setVisualOpacity(0, 0);
      }
    };

    const finish = () => {
      const surface = arrival?.surfaceTarget;
      const spacer = arrival?.spacerTarget;
      const surfaceTop = surface?.isConnected
        ? surface.getBoundingClientRect().top
        : null;
      setVisualOpacity(0, 0);
      setEntryExposure(1);
      clearParchmentReveal();
      arrivalDetailRef.current = null;
      skipRequestedRef.current = false;
      bookPaintedRef.current = false;
      entryPaintedRef.current = false;
      entryHandoffPaintedRef.current = false;
      commitPhase("idle");
      destinationRef.current = null;
      clearArrivalMarker();
      document.documentElement.classList.add("ss-instant-scroll");
      unlockContent();
      spacer?.style.removeProperty("--ss-story-arrival-height");
      if (surface?.isConnected && surfaceTop !== null) {
        const collapsedTop = surface.getBoundingClientRect().top;
        window.scrollBy({
          top: collapsedTop - surfaceTop,
          left: 0,
          behavior: "auto",
        });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove("ss-instant-scroll");
      });
      const focusTarget = arrival?.focusTarget;
      if (focusTarget?.isConnected) {
        if (!focusTarget.matches("a,button,input,select,textarea,[tabindex]")) {
          focusTarget.setAttribute("tabindex", "-1");
        }
        focusTarget.focus({ preventScroll: true });
      }
    };

    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisualOpacity(0, 0);
      finish();
      return;
    }

    if (!revealFromEntryFrame) {
      finish();
      return;
    }

    if (arrival?.revealMode === "fade") {
      setStatus("Opening this story…");
      const startedAt = performance.now();
      const fadeToStory = (now: number) => {
        const progress = clamp((now - startedAt) / FADE_REVEAL_MS);
        const opacity = 1 - smoothstep(0, 1, progress);
        setRevealCoverOpacity(opacity);
        if (progress >= 1) finish();
        else animationFrameRef.current = window.requestAnimationFrame(fadeToStory);
      };
      animationFrameRef.current = window.requestAnimationFrame(fadeToStory);
      return;
    }

    // `revealing` restores the desktop scrollbar. Measure after two painted
    // frames so the target width is the reader's settled width, not the locked
    // routing width (which differs by one scrollbar on desktop).
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        const rootRect = document.documentElement.getBoundingClientRect();
        const cssWidth = Math.max(
          1,
          rootRect.width || window.visualViewport?.width || window.innerWidth,
        );
        const cssHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
        const startGeometry = handoffGeometryRef.current ?? handoffTextureGeometry({
          viewportWidth: cssWidth,
          viewportHeight: cssHeight,
          viewportLeft: rootRect.left,
          viewportTop: 0,
          parchmentScale: entryManifest?.handoff?.parchmentScale ?? 1.2,
          sourceYOffsetRatio: entryManifest?.handoff?.bridgeSourceYOffsetRatio ?? 0.4270833333,
        });
        const destinationGeometry = measureDestinationTexture(arrival?.surfaceTarget)
          ?? arrival?.textureGeometry
          ?? destinationTextureGeometry({
            surfaceWidth: rootRect.width,
            surfaceTop: 0,
          });
        const spacerTarget = arrival?.spacerTarget;
        const surfaceTarget = arrival?.surfaceTarget;
        const spacerHeight = Math.max(
          0,
          spacerTarget?.getBoundingClientRect().height ?? destinationGeometry.top,
        );
        spacerTarget?.style.setProperty("--ss-story-arrival-height", `${spacerHeight}px`);
        // The final video frame and destination texture share the same phase.
        // Keep only a tiny antialiased edge; a broad feather reads as another
        // parchment crossfade instead of one continuous scroll.
        const revealFeather = Math.min(16, Math.max(10, cssHeight * 0.014));
        handoffGeometryRef.current = startGeometry;
        // Freeze the authored handoff texture. The live paper itself supplies
        // all spatial motion; traversing a full background repeat exposed the
        // source texture's dark tail and created a catastrophic black frame.
        alignSurfaceTextureToHandoff(surfaceTarget, startGeometry);
        setParchmentRevealEdge(
          surfaceTarget?.getBoundingClientRect().top ?? cssHeight,
          revealFeather,
        );
        setRevealCoverOpacity(1);

        const startedAt = performance.now();
        const reveal = (now: number) => {
          const elapsed = now - startedAt;
          const progress = clamp(elapsed / DESTINATION_SCROLL_MS);
          if (progress < 1) {
            const remainingSpacerHeight = spacerHeight
              * (1 - smoothstep(0, 1, progress));
            spacerTarget?.style.setProperty(
              "--ss-story-arrival-height",
              `${remainingSpacerHeight}px`,
            );
            alignSurfaceTextureToHandoff(surfaceTarget, startGeometry);
            const paperTop = surfaceTarget?.getBoundingClientRect().top
              ?? cssHeight * (1 - progress);
            setParchmentRevealEdge(paperTop, revealFeather);
            setRevealCoverOpacity(1);
            animationFrameRef.current = window.requestAnimationFrame(reveal);
            return;
          }

          spacerTarget?.style.setProperty("--ss-story-arrival-height", "0px");
          alignSurfaceTextureToHandoff(surfaceTarget, startGeometry);
          const paperTop = surfaceTarget?.getBoundingClientRect().top ?? -1;
          const settleProgress = clamp((elapsed - DESTINATION_SCROLL_MS) / DESTINATION_SETTLE_MS);
          setParchmentRevealEdge(
            paperTop - (revealFeather * 2 + 2) * smoothstep(0, 1, settleProgress),
            revealFeather,
          );
          setRevealCoverOpacity(1);
          if (settleProgress >= 1) finish();
          else animationFrameRef.current = window.requestAnimationFrame(reveal);
        };
        animationFrameRef.current = window.requestAnimationFrame(reveal);
      });
    });
  }, [
    clearParchmentReveal,
    commitPhase,
    entryManifest,
    setEntryExposure,
    setParchmentRevealEdge,
    setVisualOpacity,
    unlockContent,
  ]);

  const beginRouting = useCallback((immediateReveal = false) => {
    const destination = destinationRef.current;
    if (!destination) return;
    lockContent();
    skipRequestedRef.current ||= immediateReveal;
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    setHandoffOpacity(1);
    commitPhase("routing");
    setStatus(`Opening ${destination.label}…`);
    writeArrivalMarker(destination);

    try {
      router.push(destination.href);
    } catch {
      window.location.assign(destination.href);
      return;
    }

    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = window.setTimeout(() => {
      routeTimerRef.current = 0;
      if (!currentRouteMatches(destination.href)) {
        cancelTransition();
        return;
      }
      // Keep the matched parchment covering a slow or failed destination.
      // The explicit Reveal control remains available, but an automatic
      // timeout must not expose a half-built title leaf.
      setStatus(`${destination.label} is taking longer than expected to prepare…`);
    }, DESTINATION_READY_TIMEOUT_MS);
  }, [cancelTransition, commitPhase, lockContent, router, setHandoffOpacity]);

  const playTransition = useCallback((destination: PendingDestination) => {
    if (phaseRef.current !== "idle") return;
    destinationRef.current = destination;
    clearParchmentReveal();
    skipRequestedRef.current = false;
    bookPaintedRef.current = false;
    entryPaintedRef.current = false;
    entryHandoffPaintedRef.current = false;
    focusedBeforeRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    sizeCanvases();
    // Let the visible folio ink fade over the library's own already-painted
    // canvas. Deferring the scroll lock avoids reallocating that canvas while
    // the transition overlay is still transparent, which otherwise exposes a
    // brief black frame on both narrow screens and scrollbar-bearing desktops.
    activateContentTransition();
    setStatus(`Turning the page to ${destination.label}…`);
    commitPhase("folio-out");
    // The catalog's own canvas is already the correct blank-book plate. Keep
    // this overlay transparent until its matching first frame has decoded.
    setVisualOpacity(0, 0);
    window.requestAnimationFrame(() => skipRef.current?.focus({ preventScroll: true }));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bookVariant = libraryManifest ? selectVariant(libraryManifest) : null;
    const scrollVariant = entryManifest ? selectVariant(entryManifest) : null;
    selectedVariantsRef.current = { book: bookVariant, entry: scrollVariant };
    if (reducedMotion || !libraryManifest || !bookVariant || !entryManifest || !scrollVariant) {
      lockContent();
      setHandoffOpacity(1);
      beginRouting(true);
      return;
    }

    const bookStart = Math.max(0, libraryManifest.frames.turnStartIndex ?? 195);
    const bookCount = Math.max(
      1,
      Math.min(
        libraryManifest.frames.turnCount ?? 68,
        libraryManifest.frames.count - bookStart,
      ),
    );
    const entryDuration = sequenceDuration(entryManifest);
    const entryExposureStart = entryManifest.handoff?.sequenceExposure?.start ?? 0.892;
    const entryStartAt = FOLIO_FADE_MS + BOOK_TURN_MS + BLANK_HOLD_MS;
    const transitionEndAt = entryStartAt + entryDuration;
    const startedAt = performance.now();

    overlayRef.current?.style.setProperty(
      "--ss-transition-parchment-scale",
      String(entryManifest.handoff?.parchmentScale ?? 1.2),
    );
    bookPaintedRef.current = drawSequence(
      bookCanvasRef.current,
      "book",
      libraryManifest,
      bookVariant,
      bookStart,
    );
    entryPaintedRef.current = drawSequence(
      entryCanvasRef.current,
      "entry",
      entryManifest,
      scrollVariant,
      0,
    );
    setEntryExposure(entryExposureStart);

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed < FOLIO_FADE_MS) {
        commitPhase("folio-out");
        const drewBook = drawSequence(
          bookCanvasRef.current,
          "book",
          libraryManifest,
          bookVariant,
          bookStart,
        );
        bookPaintedRef.current ||= drewBook;
        // Catalog ink and illustrations fade over their own still-bright page.
        // Do not crossfade the replacement canvas yet; doing so compounds
        // alpha and produces a visible dark pulse at the click.
        setVisualOpacity(0, 0);
      } else if (elapsed < FOLIO_FADE_MS + BOOK_TURN_MS) {
        const enteringBookTurn = phaseRef.current !== "book-turn";
        commitPhase("book-turn");
        const progress = clamp((elapsed - FOLIO_FADE_MS) / BOOK_TURN_MS);
        const index = bookStart + Math.round(progress * (bookCount - 1));
        const drewBook = drawSequence(
          bookCanvasRef.current,
          "book",
          libraryManifest,
          bookVariant,
          index,
        );
        bookPaintedRef.current ||= drewBook;
        // The catalog copy has finished fading. Replace its canvas in one
        // matched frame before applying the scroll lock, so there is never an
        // uncovered black interval while the viewport geometry settles.
        setVisualOpacity(bookPaintedRef.current ? 1 : 0, 0);
        if (enteringBookTurn) lockContent();
      } else if (elapsed < entryStartAt) {
        const enteringBlankHold = phaseRef.current !== "blank-hold";
        commitPhase("blank-hold");
        // The book canvas retains its final painted pixels, so the old decoded
        // window can be evicted while the new sequence is warmed.
        if (enteringBlankHold) {
          drawSequence(
            bookCanvasRef.current,
            "book",
            libraryManifest,
            bookVariant,
            bookStart + bookCount - 1,
          );
        }
        const drewEntry = drawSequence(
          entryCanvasRef.current,
          "entry",
          entryManifest,
          scrollVariant,
          0,
        );
        entryPaintedRef.current ||= drewEntry;
        const holdElapsed = elapsed - FOLIO_FADE_MS - BOOK_TURN_MS;
        const dissolve = smoothstep(
          BLANK_HOLD_MS - BLANK_DISSOLVE_MS,
          BLANK_HOLD_MS,
          holdElapsed,
        );
        setVisualOpacity(
          bookPaintedRef.current
            ? entryPaintedRef.current ? 1 - dissolve : 1
            : 0,
          entryPaintedRef.current ? dissolve : 0,
        );
      } else if (elapsed < transitionEndAt) {
        commitPhase("scroll-entry");
        const progress = clamp((elapsed - entryStartAt) / entryDuration);
        const index = sourceMappedFrame(entryManifest, progress);
        const sequenceExposure = entryExposureStart
          + (1 - entryExposureStart) * smoothstep(0.015, 0.2, progress);
        setEntryExposure(sequenceExposure);
        const drewEntry = drawSequence(
          entryCanvasRef.current,
          "entry",
          entryManifest,
          scrollVariant,
          index,
        );
        entryPaintedRef.current ||= drewEntry;
        // The authored tail already becomes clean parchment. Keep those exact
        // pixels on screen; inserting a bridge/raw-paper dissolve here creates
        // the unwanted full-screen tan beat before the destination appears.
        // The final entry frame is the only visible handoff surface. Routing
        // and the live page stay underneath it until the edge reveal begins.
        setVisualOpacity(
          entryPaintedRef.current ? 0 : 1,
          entryPaintedRef.current ? 1 : 0,
        );
      } else {
        const drewHandoff = drawSequence(
          entryCanvasRef.current,
          "entry",
          entryManifest,
          scrollVariant,
          entryManifest.frames.count - 1,
          true,
        );
        if (!drewHandoff && elapsed < transitionEndAt + HANDOFF_FRAME_WAIT_MS) {
          // Preserve the last authored pixels while the exact terminal frame
          // finishes decoding. A nearby-frame substitution cannot be assumed
          // to share the live parchment's phase.
          setVisualOpacity(0, entryPaintedRef.current ? 1 : 0);
          animationFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        entryPaintedRef.current ||= drewHandoff;
        entryHandoffPaintedRef.current = drewHandoff;
        setEntryExposure(1);
        commitPhase("handoff");
        setHandoffOpacity(1);
        beginRouting();
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [
    activateContentTransition,
    beginRouting,
    clearParchmentReveal,
    commitPhase,
    drawSequence,
    entryManifest,
    libraryManifest,
    lockContent,
    setEntryExposure,
    setHandoffOpacity,
    setVisualOpacity,
    sizeCanvases,
  ]);

  const skipTransition = useCallback(() => {
    const destination = destinationRef.current;
    if (!destination) return;
    if (phaseRef.current === "revealing") {
      finishReveal(arrivalDetailRef.current ?? undefined, true);
      return;
    }
    if (phaseRef.current === "routing") {
      if (currentRouteMatches(destination.href)) {
        finishReveal(arrivalDetailRef.current ?? undefined, true);
      } else {
        skipRequestedRef.current = true;
        setStatus("The selected story is still opening…");
      }
      return;
    }
    setHandoffOpacity(1);
    beginRouting(true);
  }, [beginRouting, finishReveal, setHandoffOpacity]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      fetchManifest(LIBRARY_MANIFEST_URL, controller.signal),
      fetchManifest(SCROLL_ENTRY_MANIFEST_URL, controller.signal),
    ]).then(([libraryResult, entryResult]) => {
      if (controller.signal.aborted) return;
      if (libraryResult.status === "fulfilled") setLibraryManifest(libraryResult.value);
      if (entryResult.status === "fulfilled") {
        setEntryManifest(entryResult.value);
        if (window.location.pathname === "/" && !connectionPrefersLessData()) {
          const warm = () => void warmSequence(entryResult.value, controller.signal);
          const idleWindow = window as typeof window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
          };
          if (idleWindow.requestIdleCallback) {
            const idleId = idleWindow.requestIdleCallback(warm, { timeout: 2_000 });
            controller.signal.addEventListener(
              "abort",
              () => idleWindow.cancelIdleCallback?.(idleId),
              { once: true },
            );
          } else {
            const timer = window.setTimeout(warm, 400);
            controller.signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
          }
        }
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[data-story-entry]");
      if (!anchor) return;
      const href = destinationFromAnchor(anchor);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      const label = anchor.getAttribute("data-story-title")
        || anchor.getAttribute("aria-label")
        || anchor.querySelector("h1,h2,h3,strong")?.textContent?.trim()
        || "the chosen story";
      playTransition({ href, label });
    };

    const prefetchAnchor = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[data-story-entry]");
      if (!anchor) return;
      const href = destinationFromAnchor(anchor);
      if (href) router.prefetch(href.split("#", 1)[0]);
    };
    const handlePointerOver = (event: PointerEvent) => prefetchAnchor(event.target);
    const handleFocusIn = (event: FocusEvent) => prefetchAnchor(event.target);

    document.addEventListener("click", handleClick, true);
    document.addEventListener("pointerover", handlePointerOver, { passive: true });
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [playTransition, router]);

  useEffect(() => {
    if (phase === "idle") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        skipTransition();
        return;
      }
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        event.preventDefault();
      }
    };
    const preventManualScroll = (event: Event) => event.preventDefault();
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("wheel", preventManualScroll, { passive: false });
    window.addEventListener("touchmove", preventManualScroll, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("wheel", preventManualScroll);
      window.removeEventListener("touchmove", preventManualScroll);
    };
  }, [phase, skipTransition]);

  useEffect(() => {
    if (phase === "idle") return;
    // Router pushes do not emit popstate. Any popstate while this experience is
    // active therefore reflects explicit reader history navigation and should
    // cancel, even if that history entry happens to share the destination URL.
    const respectHistoryNavigation = () => {
      window.requestAnimationFrame(cancelTransition);
    };
    window.addEventListener("popstate", respectHistoryNavigation);
    return () => window.removeEventListener("popstate", respectHistoryNavigation);
  }, [cancelTransition, phase]);

  useEffect(() => {
    const handleReady = (event: Event) => {
      const detail = (event as CustomEvent<ReadyEventDetail>).detail;
      const destination = destinationRef.current;
      if (!destination || !currentRouteMatches(destination.href)) return;
      finishReveal(detail, skipRequestedRef.current);
    };
    window.addEventListener(ARRIVAL_READY_EVENT, handleReady);
    return () => window.removeEventListener(ARRIVAL_READY_EVENT, handleReady);
  }, [finishReveal]);

  useEffect(() => {
    const marker = readArrivalMarker();
    if (!marker || !currentRouteMatches(marker.href) || phaseRef.current !== "idle") return;
    destinationRef.current = { href: marker.href, label: marker.label };
    lockContent();
    setHandoffOpacity(1);
    commitPhase("routing");
    setStatus(`Opening ${marker.label}…`);
    routeTimerRef.current = window.setTimeout(() => finishReveal(), DESTINATION_READY_TIMEOUT_MS);
  }, [commitPhase, finishReveal, lockContent, setHandoffOpacity]);

  useEffect(() => {
    const handleResize = () => {
      if (
        phaseRef.current === "idle"
        || phaseRef.current === "routing"
        || phaseRef.current === "revealing"
      ) return;
      // Restoring destination overflow changes the visual viewport by the
      // scrollbar width on desktop. Keep the handoff texture frozen while it
      // dissolves so that internal resize cannot masquerade as reverse motion.
      sizeCanvases();
    };
    window.addEventListener("resize", handleResize, { passive: true });
    window.visualViewport?.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [sizeCanvases]);

  useEffect(() => () => {
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    inertObserverRef.current?.disconnect();
    unlockContent();
    frameCacheRef.current.forEach((entry) => {
      entry.image.onload = null;
      entry.image.onerror = null;
      entry.image.removeAttribute("src");
    });
    frameCacheRef.current.clear();
  }, [unlockContent]);

  const active = phase !== "idle";
  return (
    <TransitionContext.Provider value={{ active, phase }}>
      {children}
      <section
        ref={overlayRef}
        className={`ss-story-transition${active ? " is-active" : ""}`}
        data-phase={phase}
        aria-labelledby="ss-story-transition-title"
        aria-modal={active ? "true" : undefined}
        role={active ? "dialog" : undefined}
        hidden={!active}
      >
        <canvas
          ref={bookCanvasRef}
          className="ss-story-transition__canvas ss-story-transition__canvas--book"
          aria-hidden="true"
        />
        <canvas
          ref={entryCanvasRef}
          className="ss-story-transition__canvas ss-story-transition__canvas--entry"
          aria-hidden="true"
        />
        <div className="ss-story-transition__a11y">
          <h2 id="ss-story-transition-title">Entering the story</h2>
          <p role="status" aria-live="polite">{status}</p>
        </div>
        <button
          ref={skipRef}
          className="ss-story-transition__skip"
          type="button"
          onClick={skipTransition}
        >
          {phase === "revealing"
            ? "Finish now"
            : phase === "routing"
              ? "Preparing story"
              : "Skip transition"}
        </button>
      </section>
    </TransitionContext.Provider>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { PlatformFooter, PlatformHeader } from "./site-shell";
import { creatorFacingCreationError } from "../../shared/creation-error-guidance.mjs";

type SourceLane = "upload" | "gutenberg" | "ai_original";
type UploadInputMode = "file" | "paste";
type IllustrationMode = "ai" | "upload";
type IllustrationDensity = "light" | "balanced" | "rich";
type RewriteChoice =
  | "faithful"
  | "summary"
  | "translate"
  | "modernize"
  | "reimagine"
  | "alternate_ending";
type SummaryLevel = "brief" | "balanced" | "detailed";
type AudienceChoice = "original" | "adapted" | "picture_book";
type IllustrationBudgetMode = "total" | "per_chapter";
type WritingTier = "economy" | "balanced" | "literary";
type ImageTier = "draft" | "standard" | "premium";
type CraftLevel = 0 | 1 | 2 | 3 | 4;
type Visibility = "private" | "unlisted" | "public";
type ScopeMode = "automatic" | "custom";
type StudioStatus =
  | "idle"
  | "preparing"
  | "approving"
  | "submitting"
  | "success"
  | "error";

type CharacterProfile = {
  name: string;
  description: string;
};

type CharacterBible = {
  id: string;
  visualBible: string;
  characters: CharacterProfile[];
  reference?: {
    url: string;
    model: string;
    tier: string;
    quality: string;
    providerSize: string;
    width: number;
    height: number;
    estimatedOutputUsd: number;
    priceCatalogVersion: string;
    approvedAt?: string | null;
    altText: string;
  };
  expiresAt?: string;
};

type CharacterApproval = {
  id: string;
  token: string;
  expiresAt?: string;
};

type CreateResult = {
  slug: string;
  url: string;
  title: string;
  listing?: { requested?: boolean; status?: string };
};

type CreationJob = {
  id: string;
  status: "running" | "completed" | "failed";
  stage: string;
  statusUrl: string;
  retryRequired?: boolean;
  error?: CreationError;
};

type CreationError = {
  code?: string;
  message?: string;
  details?: {
    currentCapUsd?: number;
    requiredEstimatedMaxUsd?: number;
    minimumIllustratedContractComplete?: boolean;
    enforcementScope?: string;
  };
  actions?: string[];
};

type SpendCapIssue = {
  currentCapUsd: number | null;
  requiredEstimatedMaxUsd: number | null;
  actions: string[];
};

type CreationJobEnvelope = {
  job?: CreationJob;
  result?: { story?: CreateResult; message?: string };
  story?: CreateResult;
  message?: string;
  error?: CreationError;
};

type CreatorSession = {
  user: {
    id: string;
    displayName: string;
    role: string;
  };
  entitlement: {
    plan: string;
    publicRequestsPerWeek: number | null;
    privateAndUnlistedUnlimited: boolean;
  };
  publicListingQuota: {
    windowDays: number;
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  csrfToken: string;
};

type ServerEstimate = {
  catalogVersion: string;
  currency: "USD" | string;
  estimatedMinUsd: number;
  estimatedMaxUsd: number;
  disclaimer: string;
  inputs?: {
    estimatedTextRequests?: number;
    visibleImageCount?: number;
    writingModel?: string;
    imageModel?: string | null;
    imageQuality?: string | null;
    continuityReferenceTier?: string | null;
    continuityReferenceModel?: string | null;
    continuityReferenceQuality?: string | null;
    continuityReferenceOutputUsd?: number | null;
  };
};

type EstimateApproval = {
  approved: true;
  catalogVersion: string;
  estimatedMinUsd: number;
  estimatedMaxUsd: number;
};

type GutenbergBook = {
  id: number;
  title: string;
  authors: string[];
  languages: string[];
  downloadCount: number | null;
  sourceUrl: string;
};

type IlluminatedSet = {
  id: string;
  slug: string;
  displayName: string;
  family: string;
  description: string;
  sampleCharacter: string;
  previewUrl: string | null;
};

type SourceVersionMatch = {
  slug: string;
  url: string;
  title: string;
  coverUrl: string | null;
  creatorName: string;
  transformation: string;
  targetAge: number | null;
  targetLanguage: string | null;
  readingDepth: string;
  format: string;
  illustrationRichness: string;
  qualityProfile: string;
  artLevel: string;
  sourceTitle: string;
  originalAuthor: string;
};

const PENDING_CREATION_STORAGE_KEY = "storyscrolls.pending-creation.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FALLBACK_ILLUMINATED_SETS: IlluminatedSet[] = [
  {
    id: "illuminatedletters:fleur-de-lis-garden-gold",
    slug: "fleur-de-lis-garden-gold",
    displayName: "Fleur-de-lis Garden Gold",
    family: "Manuscript Style",
    description: "Ornate manuscript characters with botanical flowers, gold flourishes, and fleur-de-lis motifs; a complete A–Z and 0–9 collection.",
    sampleCharacter: "F",
    previewUrl: null,
  },
  {
    id: "illuminatedletters:heather-and-rose-bronze",
    slug: "heather-and-rose-bronze",
    displayName: "Heather & Rose-Bronze",
    family: "Celtic Metalwork — Bronze, Heather & Interlace",
    description: "Insular majuscules combine aged bronze, dark oak, silver-wire interlace, restrained gold, jewel-toned enamel, heather, and bramble.",
    sampleCharacter: "H",
    previewUrl: null,
  },
  {
    id: "illuminatedletters:seven-stone-reliquary-gold",
    slug: "seven-stone-reliquary-gold",
    displayName: "Seven-Stone Reliquary Gold",
    family: "Gemstone Style",
    description: "Ceremonial goldwork initials set with ruby, emerald, sapphire, amethyst, citrine, opal, and diamond.",
    sampleCharacter: "S",
    previewUrl: null,
  },
  {
    id: "illuminatedletters:cathedral-ruby-vine",
    slug: "cathedral-ruby-vine",
    displayName: "Cathedral Ruby Vine",
    family: "Manuscript Style",
    description: "Limestone-framed stained-glass capitals with jewel-tone botanical panels, gold tracery, fruit, leaves, and floral medallions.",
    sampleCharacter: "C",
    previewUrl: null,
  },
];

const CREATOR_STEPS = [
  ["Source", "Choose the material"],
  ["Rights", "Confirm permission"],
  ["Story", "Shape the telling"],
  ["Reader", "Set the audience"],
  ["Art", "Build the visual world"],
  ["Review", "Approve and create"],
] as const;

type StudioStepGuide = {
  readonly title: string;
  readonly summary: string;
  readonly decision: string;
  readonly tip: string;
  readonly checklist: readonly string[];
  readonly next: string;
};

const STUDIO_STEP_GUIDES = [
  {
    title: "Begin with the right kind of source.",
    summary: "Choose whether you are bringing a manuscript, adapting a public-domain edition, or developing an original story from a guided plan.",
    decision: "The source, creator credit, working title, and—when you are writing something new—the story’s essential dramatic choices.",
    tip: "For an original, describe cause and consequence rather than polished prose. The studio will shape the language later.",
    checklist: ["Choose a source path.", "Name the creator and working title.", "Provide the source material or original-story plan."],
    next: "The next screen records permission, unless a verified public-domain catalog record already supplies that trail.",
  },
  {
    title: "Make the permission trail clear.",
    summary: "Record why the source may be transformed and which edition, license, or ownership claim supports that use.",
    decision: "Whether you own the work, are using a qualifying public-domain edition, or have an explicit license.",
    tip: "Use the most authoritative source link you have. A storefront or search-result page is rarely the best evidence.",
    checklist: ["Choose the true rights basis.", "Add a plain-language note and authoritative links when needed.", "Confirm your right to transform, store, and share the work."],
    next: "Story Shape asks what may change and how long this edition should be.",
  },
  {
    title: "Set the boundaries of the telling.",
    summary: "Choose what may change, how long the scroll should be, and which parts of the source must remain intact.",
    decision: "Treatment, chapter count, chapter length, and any adaptation boundaries.",
    tip: "A smaller, explicit brief usually produces a more coherent result than a long list of competing wishes.",
    checklist: ["Choose one primary treatment.", "Complete only the fields that treatment reveals.", "Accept the automatic length or open an exact override."],
    next: "Reader combines audience design with the overall craft investment.",
  },
  {
    title: "Design for one real reader.",
    summary: "Choose the intended reading level and how much editorial and visual craft to invest in this edition.",
    decision: "Audience, age adaptation, writing craft, revision depth, illustration frequency, and finish.",
    tip: "Start with Storybook unless you are testing an idea or deliberately commissioning a more elaborate edition.",
    checklist: ["Choose original voice, age adaptation, or picture-book mode.", "Set the age when adapting.", "Choose a craft preset or deliberately fine-tune it."],
    next: "Art turns those reader and craft choices into one visual system.",
  },
  {
    title: "Give the whole scroll one visual language.",
    summary: "Direct the illustration style, continuity plan, illuminated initials, and reading type as one coherent system.",
    decision: "AI-made or supplied art, image count, visual direction, initials, and the story font.",
    tip: "Describe medium, palette, light, texture, and mood. Avoid naming a living artist; describe the qualities you admire instead.",
    checklist: ["Choose generated or supplied artwork.", "Complete the visual plan and image coverage.", "Choose illuminated initials and comfortable reading type."],
    next: "Review fetches a fresh server estimate for this exact plan before anything is generated.",
  },
  {
    title: "Approve the exact plan before production.",
    summary: "Review provenance, visibility, estimated API work, and—when using AI art—the actual continuity reference supplied to every image.",
    decision: "Sharing level, cost authorization, character-reference approval, and the final creation request.",
    tip: "Start with a small prepaid balance, leave Auto recharge off if you want tighter control, and treat project budgets as alerts rather than hard caps.",
    checklist: ["Check the complete plan and visibility.", "Review the fresh estimate and authorization language.", "Enter your key only for the request you are ready to approve."],
    next: "Generated art pauses for visual-guide approval; supplied art can proceed directly to scroll production.",
  },
] as const satisfies readonly StudioStepGuide[];

function studioGuideForStep({
  step,
  sourceLane,
  illustrationMode,
  isPictureBook,
  plannedChapters,
  visibleImages,
  hasCharacterBible,
  characterApproved,
}: {
  step: number;
  sourceLane: SourceLane;
  illustrationMode: IllustrationMode;
  isPictureBook: boolean;
  plannedChapters: number;
  visibleImages: number;
  hasCharacterBible: boolean;
  characterApproved: boolean;
}): StudioStepGuide {
  const base = STUDIO_STEP_GUIDES[step - 1] ?? STUDIO_STEP_GUIDES[0];

  if (step === 1 && sourceLane === "upload") {
    return {
      ...base,
      checklist: [
        "Choose a UTF-8 .txt or .md file, or paste at least 80 characters of text.",
        "Enter the original title and author so the finished colophon credits the source correctly.",
        "Set the creator credit and working scroll title; you can refine the title on Review.",
      ],
      next: "Continue to Rights and identify whether you own the manuscript, it is public domain, or you have a license.",
    };
  }

  if (step === 1 && sourceLane === "gutenberg") {
    return {
      ...base,
      summary: "Search the public-domain catalog, choose the exact eBook record, and confirm the title-page credit for this new edition.",
      decision: "The exact catalog edition, creator credit, and working title.",
      checklist: [
        "Search by title or author and choose the intended eBook record—or enter its eBook number directly.",
        "Check the title and author filled from that record.",
        "Add your creator credit and the title readers will see on this scroll.",
      ],
      next: "The verified catalog record supplies the source and rights trail, so the separate Rights screen is skipped. You go directly to Story Shape.",
    };
  }

  if (step === 1 && sourceLane === "ai_original") {
    return {
      ...base,
      summary: "Build a practical story blueprint: who wants what, what pushes back, how pressure changes them, and what ending those choices earn.",
      decision: "Creator credit, title, premise, setting, cast, want and need, conflict, stakes, act turns, arc, theme, ending, and reader promise.",
      checklist: [
        "Name the scroll and describe the premise, atmosphere, protagonist, and supporting cast.",
        "Connect want, need, conflict, and stakes so the story has a dramatic engine.",
        "Complete the three act turns, character arc, theme, ending, and promised feeling.",
      ],
      next: "Rights asks for a simple ownership confirmation, then Story Shape sets the first draft’s production bounds.",
    };
  }

  if (step === 2 && sourceLane === "ai_original") {
    return {
      ...base,
      summary: "Confirm that the original plan is yours and may be drafted, illustrated, stored, and shared through the Studio.",
      decision: "Your ownership confirmation.",
      checklist: [
        "Keep “I own it” selected for your original story plan.",
        "Read the scope of the confirmation: submission, transformation, illustration, storage, and sharing.",
        "Check the confirmation only when it is accurate.",
      ],
      next: "Story Shape sets the chapter plan and approximate length of the first draft.",
    };
  }

  if (step === 2) {
    return {
      ...base,
      checklist: [
        "Choose I own it, Public domain, or Licensed—whichever is actually true for this manuscript.",
        "For public-domain or licensed material, add a plain-language permission note and authoritative HTTPS links.",
        "Confirm the complete rights statement before continuing.",
      ],
      next: "Story Shape lets you choose the transformation, its boundaries, and the intended length.",
    };
  }

  if (step === 3 && sourceLane === "ai_original") {
    return {
      ...base,
      title: "Set the first draft’s production bounds.",
      summary: "Your workshop plan remains the story source; this screen decides how the Studio should divide and pace the draft.",
      decision: `Automatic pacing or an exact plan for ${plannedChapters} ${plannedChapters === 1 ? "chapter" : "chapters"}.`,
      checklist: [
        "Use Automatic for a coherent first pass based on the workshop plan and intended reader.",
        "Use Exact override only when chapter count or words per chapter are firm requirements.",
        "Change opening-note cleanup only if the source plan deliberately begins with bracketed notes.",
      ],
      next: "Reader chooses who the story is for and how much writing, revision, and visual craft to commission.",
    };
  }

  if (step === 3) {
    return {
      ...base,
      checklist: [
        "If approved public versions appear, review them for context or dismiss them and continue with your own interpretation.",
        "Choose one treatment, then complete only its revealed options and any essential adaptation guidance.",
        "Use Automatic length for a balanced plan, or Exact override for firm chapter and word limits.",
        "Review opening-note cleanup; it affects only balanced marks at the very start of a chapter.",
      ],
      next: "Reader combines the audience choice with a named craft preset and optional fine controls.",
    };
  }

  if (step === 4) {
    return {
      ...base,
      summary: "Choose the reading experience first, then select a balanced craft preset or open the individual production controls.",
      decision: isPictureBook
        ? "An image-only picture book, target age, and the writing, revision, illustration, fidelity, and delivery plan behind it."
        : "Original voice or an age-adapted edition, plus the writing, revision, illustration, fidelity, and delivery plan.",
      checklist: [
        "Choose Original voice, Adapt for an age, or Picture-book mode; set a target age when it appears.",
        "Choose Sketch, Storybook, Crafted, Heirloom, or Masterwork as a balanced starting bundle.",
        "Open Fine-tune only when you need to change writing craft, revision passes, image frequency, art fidelity, or delivery quality separately.",
      ],
      next: isPictureBook
        ? "Art is next. Picture-book mode keeps generated illustrations on and asks images and accessible alt text to carry the reading body."
        : "Art is next. The selected craft bundle already provides an image count and fidelity that you can refine there.",
    };
  }

  if (step === 5 && illustrationMode === "upload") {
    return {
      ...base,
      summary: `Supply the complete visual system for ${plannedChapters} ${plannedChapters === 1 ? "chapter" : "chapters"}, then choose the illuminated initials and sustained-reading type.`,
      decision: "A rights-cleared cover, every chapter hero and inline placement, artwork credit, initials, and reading font.",
      checklist: [
        "Name 000 as the cover; use chCC-hero for each chapter opener and chCC-pctPPP-ALIGN for inline placement.",
        "Include meaningful alt text in each filename, add the artwork credit, and confirm your publishing rights.",
        "Choose one complete illuminated alphabet and a font comfortable for the story’s reader.",
      ],
      next: "Review checks the complete upload set, fetches the current estimate, and proceeds without a generated visual-guide pause.",
    };
  }

  if (step === 5) {
    return {
      ...base,
      summary: `Direct ${visibleImages} planned images across ${plannedChapters} ${plannedChapters === 1 ? "chapter" : "chapters"}, plus the initials and reading type that complete the page design.`,
      decision: "Illustration language, art direction, continuity cast, image allocation, illuminated alphabet, and reading font.",
      checklist: [
        "Choose a suggested illustration language or describe medium, palette, light, texture, mood, and exclusions in your own words.",
        "Name only recurring characters who need exact continuity, then confirm the total or per-chapter image budget.",
        "Choose flexible allocation for story-aware extra scenes, then select illuminated initials and reading type.",
      ],
      next: "Review fetches a fresh estimate. Your first approved request makes only the low-cost visual reference—no cover or story scenes yet.",
    };
  }

  if (step === 6 && illustrationMode === "upload") {
    return {
      ...base,
      summary: "Check the complete edition record, sharing level, uploaded-art coverage, and fresh estimate before starting production.",
      decision: "Provenance wording, visibility, estimate authorization, transient API-key use, and final creation.",
      checklist: [
        "Review the title-page source details, plain-language change description, and complete plan summary.",
        "Choose Private, Unlisted, or Public and inspect the fresh estimated range and request count.",
        "Paste your API key, read and check the authorization, then create the scroll.",
      ],
      next: "The Studio begins text production and artwork checks. A recoverable job message tells you when it is safe to leave and return.",
    };
  }

  if (step === 6 && !hasCharacterBible) {
    return {
      ...base,
      checklist: [
        "Review provenance, the plan summary, visibility, the fresh estimate, and expected requests.",
        "Paste your API key and check the authorization only when this exact plan is ready.",
        "Choose Prepare character guide; this first request creates only a low-cost continuity sheet and written visual guide.",
      ],
      next: "Production pauses on this same screen. Inspect the returned guide before approving it; no cover or interior illustration has been created yet.",
    };
  }

  if (step === 6 && !characterApproved) {
    return {
      ...base,
      title: "Inspect the exact visual reference.",
      summary: "The Studio has prepared the sheet and written character guide that every final illustration will receive.",
      decision: "Approve this exact reference, or go back and revise the story or art inputs before preparing a replacement.",
      checklist: [
        "Inspect the visual language and every recurring character for appearance, age, clothing, scale, and identifying details.",
        "If anything is wrong, go back and change the relevant input; changing the plan clears this reference.",
        "Approve only the exact sheet you want reused across every final image.",
      ],
      next: "After approval, re-enter your API key and confirm the final-production request. The approved sheet is reused rather than regenerated.",
    };
  }

  if (step === 6) {
    return {
      ...base,
      title: "The visual reference is approved—start final production.",
      summary: "The exact continuity sheet is locked to the illustration plan and will now accompany every final image request.",
      decision: "Final estimate authorization and the production request.",
      checklist: [
        "Confirm the approval indicator shows the exact continuity reference you reviewed.",
        "Re-check the estimate and request authorization, then paste your API key again; the earlier entry was cleared.",
        "Choose Create my scroll and keep the recoverable job message until the finished link appears.",
      ],
      next: "The Studio creates the text and final illustration set. You may safely leave after the recoverable job message appears and return to continue tracking it.",
    };
  }

  return base;
}

const CRAFT_PROFILES: ReadonlyArray<{
  level: CraftLevel;
  name: string;
  promise: string;
  gains: string;
  writingTier: WritingTier;
  imageTier: ImageTier;
  refinementPasses: number;
  imagesPerChapter: number;
  outputSize: "web" | "standard" | "retina";
  textModel: string;
  imageQuality: string;
}> = [
  { level: 0, name: "Sketch", promise: "Find the shape", gains: "A clean first telling and low-cost visual proofs. Best for experiments before you invest in polish.", writingTier: "economy", imageTier: "draft", refinementPasses: 0, imagesPerChapter: 2, outputSize: "web", textModel: "GPT-5.6 Luna", imageQuality: "low" },
  { level: 1, name: "Storybook", promise: "Ready to share", gains: "Stronger voice and continuity, with balanced full-color illustrations. The best starting point for most scrolls.", writingTier: "balanced", imageTier: "standard", refinementPasses: 0, imagesPerChapter: 2, outputSize: "standard", textModel: "GPT-5.6 Terra", imageQuality: "medium" },
  { level: 2, name: "Crafted", promise: "One careful revision", gains: "Quality-first literary drafting plus a dedicated revision pass for arc, voice, causality, and consistency.", writingTier: "literary", imageTier: "standard", refinementPasses: 1, imagesPerChapter: 3, outputSize: "standard", textModel: "GPT-5.6 Sol", imageQuality: "medium" },
  { level: 3, name: "Heirloom", promise: "Deeply polished", gains: "Two revision passes, richer scene coverage, and premium illustrations for a story built to revisit.", writingTier: "literary", imageTier: "premium", refinementPasses: 2, imagesPerChapter: 4, outputSize: "retina", textModel: "GPT-5.6 Sol", imageQuality: "high" },
  { level: 4, name: "Masterwork", promise: "Maximum care", gains: "Three deliberate revision passes, abundant scenes, and premium art with archival delivery quality for the richest finish this pipeline can offer.", writingTier: "literary", imageTier: "premium", refinementPasses: 3, imagesPerChapter: 5, outputSize: "retina", textModel: "GPT-5.6 Sol", imageQuality: "high" },
] as const;

// Authentication is fully implemented but intentionally staged behind a release switch.
// Keep the studio usable until OAuth credentials and the final production callback are live.
const CREATOR_AUTH_REQUIRED = process.env.NEXT_PUBLIC_CREATOR_AUTH_REQUIRED === "true";
const COST_CATALOG_VERSION = "openai-public-2026-07-21";
const ILLUSTRATION_NAME_PATTERN = /^(?:000__cover__[a-z0-9][a-z0-9-]{0,79}|(?!000)\d{3}__ch(?:0[1-9]|1\d|2[0-4])(?:-hero|-pct(?:000|025|050|075|100)-(?:left|right|plate))__[a-z0-9][a-z0-9-]{0,79})\.(?:jpe?g|png|webp)$/;
const ILLUSTRATION_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MANUSCRIPT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown", ""]);
const MAX_ILLUSTRATION_FILES = 60;
const MAX_ILLUSTRATION_FILE_BYTES = 6 * 1024 * 1024;
const MAX_ILLUSTRATION_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_MANUSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_URLS = 10;
const MAX_SOURCE_CHARACTERS = 4_000_000;
const DIRECT_SOURCE_CHARACTERS = 240_000;
const SUMMARY_CHUNK_CHARACTERS = 150_000;

function isValidHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048;
  } catch {
    return false;
  }
}

function parseGutenbergId(value: string) {
  const trimmed = value.trim();
  if (/^\d{1,7}$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/gutenberg\.org\/(?:ebooks\/|cache\/epub\/)(\d{1,7})/i);
  return match ? Number(match[1]) : null;
}

function parseContinuityCharacters(value: string) {
  return value
    .split(/\r?\n/)
    .map((name) => name.normalize("NFKC").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  la: "Latin",
  nl: "Dutch",
  no: "Norwegian",
  pt: "Portuguese",
  ru: "Russian",
  sv: "Swedish",
  zh: "Chinese",
};

function languageLabel(code: string) {
  const normalized = code.trim().toLocaleLowerCase();
  return LANGUAGE_NAMES[normalized] ?? normalized.toLocaleUpperCase();
}

function normalizeIlluminatedSet(value: unknown): IlluminatedSet | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const derivatives = item.derivatives && typeof item.derivatives === "object"
    ? item.derivatives as Record<string, unknown>
    : null;
  const cardPreview = derivatives?.cardPreview && typeof derivatives.cardPreview === "object"
    ? derivatives.cardPreview as Record<string, unknown>
    : null;
  const id = typeof item.id === "string" ? item.id : "";
  const slug = typeof item.slug === "string" ? item.slug : id.replace(/^illuminatedletters:/, "");
  const displayName = typeof item.displayName === "string"
    ? item.displayName
    : typeof item.name === "string"
      ? item.name
      : slug;
  if (!id || !slug || !displayName) return null;
  return {
    id,
    slug,
    displayName,
    family: typeof item.family === "string" ? item.family : "Illuminated Letters",
    description: typeof item.description === "string" ? item.description : "A complete illuminated alphabet.",
    sampleCharacter: typeof item.sampleCharacter === "string" ? item.sampleCharacter.slice(0, 1) : "A",
    previewUrl:
      typeof item.previewUrl === "string"
        ? item.previewUrl
        : typeof cardPreview?.url === "string"
          ? cardPreview.url
          : null,
  };
}

function normalizeSourceVersion(value: unknown): SourceVersionMatch | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const slug = typeof item.slug === "string" ? item.slug : "";
  const url = typeof item.url === "string" ? item.url : slug ? `/shared/${encodeURIComponent(slug)}/` : "";
  const title = typeof item.title === "string" ? item.title : "";
  if (!slug || !url || !title) return null;
  const transformation = item.transformation && typeof item.transformation === "object"
    ? item.transformation as Record<string, unknown>
    : {};
  const reimagination = transformation.reimagination && typeof transformation.reimagination === "object"
    ? transformation.reimagination as Record<string, unknown>
    : {};
  const transformationLabel = reimagination.enabled === true
    ? "reimagining"
    : typeof transformation.targetLanguage === "string" && transformation.targetLanguage
      ? "translation"
      : transformation.modernization && transformation.modernization !== "none"
        ? "modernized edition"
        : transformation.mode === "summary"
          ? "story digest"
          : typeof item.transformation === "string"
            ? item.transformation
            : "faithful illustrated edition";
  const illustrationCount = typeof item.illustrationCount === "number" ? item.illustrationCount : null;
  return {
    slug,
    url,
    title,
    coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : null,
    creatorName: typeof item.creatorName === "string" ? item.creatorName : "Community storyteller",
    transformation: transformationLabel,
    targetAge: Number.isInteger(item.targetAge) ? item.targetAge as number : null,
    targetLanguage: typeof item.targetLanguage === "string" ? item.targetLanguage : null,
    readingDepth: typeof item.readingDepth === "string" ? item.readingDepth : "full",
    format: typeof item.format === "string" ? item.format : "prose",
    illustrationRichness: typeof item.illustrationRichness === "string"
      ? item.illustrationRichness
      : illustrationCount === null
        ? "illustrated"
        : illustrationCount >= 16
          ? "lavish"
          : illustrationCount >= 6
            ? "rich"
            : "essential",
    qualityProfile: typeof item.qualityProfile === "string" ? item.qualityProfile : "Storybook",
    artLevel: typeof item.artLevel === "string" ? item.artLevel : "illustrated",
    sourceTitle: typeof item.sourceTitle === "string" ? item.sourceTitle : title,
    originalAuthor: typeof item.originalAuthor === "string" ? item.originalAuthor : "Unknown author",
  };
}

function field(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim();
}

function requiredInteriorCount(chapters: number) {
  return chapters * 2;
}

function illustrationCounts(
  chapters: number,
  budgetMode: IllustrationBudgetMode,
  budgetCount: number,
) {
  const visible = budgetMode === "total" ? budgetCount : 1 + chapters * budgetCount;
  return {
    visible,
    cover: 1,
    heroes: chapters,
    inline: Math.max(chapters, visible - chapters - 1),
    imageRequests: visible + 1,
  };
}

function legacyDensityForBudget(
  chapters: number,
  budgetMode: IllustrationBudgetMode,
  budgetCount: number,
): IllustrationDensity {
  const interior = budgetMode === "total" ? Math.max(0, budgetCount - 1) : chapters * budgetCount;
  const imagesPerChapter = interior / Math.max(chapters, 1);
  if (imagesPerChapter <= 2) return "light";
  if (imagesPerChapter <= 3) return "balanced";
  return "rich";
}

function readingGuidance(age: number) {
  if (age <= 5) return "Very short language, clear emotional beats, and images that carry most of the action.";
  if (age <= 8) return "Concrete sentences, a gentle pace, and illustrations for every important turn.";
  if (age <= 12) return "Accessible vocabulary with the plot, wonder, and character choices kept intact.";
  if (age <= 17) return "Teen-readable prose that preserves complexity while clarifying older language.";
  return "Adult-readable prose adapted to the selected age without flattening the story’s ideas.";
}

function automaticStoryScope({
  sourceLane,
  sourceCharacters,
  rewriteChoice,
  summaryLevel,
  audienceChoice,
  targetReaderAge,
}: {
  sourceLane: SourceLane;
  sourceCharacters: number;
  rewriteChoice: RewriteChoice;
  summaryLevel: SummaryLevel;
  audienceChoice: AudienceChoice;
  targetReaderAge: number;
}) {
  let chapters = sourceLane === "ai_original" ? 6 : 10;
  if (sourceLane !== "ai_original" && sourceCharacters > 0) {
    chapters = sourceCharacters >= 1_200_000
      ? 20
      : sourceCharacters >= 650_000
        ? 16
        : sourceCharacters >= 300_000
          ? 12
          : sourceCharacters >= 120_000
            ? 9
            : 6;
  }
  if (rewriteChoice === "summary") {
    chapters = summaryLevel === "brief" ? 4 : summaryLevel === "detailed" ? 10 : 6;
  } else if (rewriteChoice === "reimagine") {
    chapters = Math.min(chapters, 8);
  }

  if (audienceChoice === "picture_book") chapters = Math.min(8, Math.max(4, chapters));
  else if (audienceChoice === "adapted" && targetReaderAge <= 5) chapters = Math.min(6, chapters);
  else if (audienceChoice === "adapted" && targetReaderAge <= 8) chapters = Math.min(8, chapters);

  let wordsPerChapter = sourceLane === "ai_original" ? 900 : 1_350;
  if (rewriteChoice === "summary") {
    wordsPerChapter = summaryLevel === "brief" ? 400 : summaryLevel === "detailed" ? 1_000 : 700;
  }
  if (audienceChoice === "picture_book") wordsPerChapter = 100;
  else if (audienceChoice === "adapted" && targetReaderAge <= 5) wordsPerChapter = 200;
  else if (audienceChoice === "adapted" && targetReaderAge <= 8) wordsPerChapter = 350;
  else if (audienceChoice === "adapted" && targetReaderAge <= 12) wordsPerChapter = 650;
  else if (audienceChoice === "adapted" && targetReaderAge <= 17) wordsPerChapter = 900;

  return { chapters, wordsPerChapter };
}

function artStyleSuggestions(age: number, pictureBook: boolean) {
  const safety = pictureBook
    ? "Clear silhouettes, readable emotion, generous negative space, and a gentle non-frightening palette keep each image legible without text."
    : "The visual language supports the reader’s developmental stage while leaving room for wonder and complexity.";
  if (age <= 4) return {
    rationale: `Very young readers follow shape, expression, and color before detail. ${safety}`,
    styles: ["tactile cut-paper", "soft crayon", "gentle watercolor", "simple expressive shapes"],
  };
  if (age <= 7) return {
    rationale: `Warm texture and friendly silhouettes make action easy to follow. ${safety}`,
    styles: ["warm storybook gouache", "colored pencil", "woodland watercolor"],
  };
  if (age <= 10) return {
    rationale: `Adventure can carry more atmosphere and detail while the action stays clear. ${safety}`,
    styles: ["luminous watercolor", "ink adventure", "painted story map"],
  };
  if (age <= 13) return {
    rationale: `Stronger contrast and graphic shape give growing readers energy without losing emotional clarity. ${safety}`,
    styles: ["bold graphic-novel ink", "textured linocut", "expressive ink and color"],
  };
  if (age <= 17) return {
    rationale: `Older readers can enjoy cinematic mood, ambiguity, and denser visual storytelling. ${safety}`,
    styles: ["cinematic ink-and-wash", "moody concept illustration", "atmospheric mixed media"],
  };
  return {
    rationale: `Adult editions can carry historical texture, subtle atmosphere, and finely observed materials. ${safety}`,
    styles: ["illuminated manuscript", "painterly realism", "atmospheric engraving"],
  };
}

function originalStoryBrief(data: FormData) {
  return [
    "Create an original, complete story from this author-guided plan.",
    `Premise: ${field(data, "premise")}`,
    `Setting and atmosphere: ${field(data, "settingAndTone")}`,
    `Main character: ${field(data, "protagonist")}`,
    `Supporting characters: ${field(data, "supportingCharacters") || "Choose only the characters the story truly needs."}`,
    `What the protagonist wants: ${field(data, "characterDesire")}`,
    `What the protagonist truly needs: ${field(data, "characterNeed")}`,
    `Central conflict: ${field(data, "centralConflict")}`,
    `Stakes: ${field(data, "stakes")}`,
    `Inciting turn: ${field(data, "incitingTurn")}`,
    `Escalation and midpoint reversal: ${field(data, "midpointTurn")}`,
    `Crisis, decisive choice, and climax: ${field(data, "climaxChoice")}`,
    `Character arc from beginning to end: ${field(data, "characterArc")}`,
    `Theme or lesson: ${field(data, "themeLesson")}`,
    `Ending and emotional resolution: ${field(data, "plannedEnding")}`,
    `Reader experience: ${field(data, "readerPromise")}`,
    "Build a causal chapter arc before drafting. Preserve character continuity, let choices have consequences, and earn the ending rather than announcing the lesson.",
  ].join("\n");
}

function transformationDescription(choice: RewriteChoice, data: FormData) {
  if (choice === "summary") return `${field(data, "summaryLevel") || "balanced"} story digest preserving the complete causal arc and ending`;
  if (choice === "translate") return `translation into ${field(data, "targetLanguage")}`;
  if (choice === "modernize") return `${field(data, "modernization") || "full"} modern-language adaptation`;
  if (choice === "reimagine") return `reimagining: ${field(data, "reimaginationNotes")}`;
  if (choice === "alternate_ending") return `alternate ending: ${field(data, "alternateEnding")}`;
  return "faithful illustrated edition with only requested reader-level adjustments";
}

function estimateCost({
  sourceCharacters,
  targetWords,
  textRequests,
  visibleImages,
  writingTier,
  imageTier,
}: {
  sourceCharacters: number;
  targetWords: number;
  textRequests: number;
  visibleImages: number;
  writingTier: WritingTier;
  imageTier: ImageTier;
}) {
  // Text rates mirror the public GPT-5.6 Luna/Sol rates at the catalog date.
  // Image allowances are intentionally broad because size, quality, prompt input,
  // reference edits, and the provider's live pricing all affect actual charges.
  const textRates = writingTier === "literary"
    ? { input: 5, output: 30 }
    : writingTier === "balanced"
      ? { input: 2.5, output: 15 }
      : { input: 1, output: 6 };
  const imageAllowances = {
    draft: { low: 0.01, high: 0.035 },
    standard: { low: 0.035, high: 0.11 },
    premium: { low: 0.13, high: 0.28 },
  } as const;
  const inputTokens = Math.max(1_500, Math.ceil(sourceCharacters / 4));
  const outputTokens = Math.max(1_500, Math.ceil(targetWords * 1.5));
  const textBase = (inputTokens * textRates.input + outputTokens * textRates.output) / 1_000_000;
  const textMultiplier = Math.max(1, textRequests * 0.85);
  const continuityReferenceRequests = visibleImages > 0 ? 1 : 0;
  const images = imageAllowances[imageTier];
  const continuityReference = imageAllowances.draft;
  // Delivery encoding is local post-processing and must not be represented as
  // additional OpenAI generation cost. Art fidelity is the paid detail control.
  const minimum = textBase * textMultiplier
    + visibleImages * images.low
    + continuityReferenceRequests * continuityReference.low;
  const maximum = textBase * textMultiplier * 2.25
    + visibleImages * images.high
    + continuityReferenceRequests * continuityReference.high;
  return {
    minimum: Math.max(0.05, Math.round(minimum * 100) / 100),
    maximum: Math.max(0.15, Math.round(maximum * 100) / 100),
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function recommendedSpendCap(estimatedMaxUsd: number) {
  const estimate = Number.isFinite(estimatedMaxUsd) ? Math.max(0.01, estimatedMaxUsd) : 0.15;
  const planningCushion = Math.max(0.25, estimate * 0.15);
  return Math.ceil((estimate + planningCushion) * 100) / 100;
}

function parseSpendCap(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 10_000) return null;
  return Math.round(parsed * 100) / 100;
}

function spendCapIssueFromError(error?: CreationError): SpendCapIssue | null {
  if (error?.code !== "SPEND_CAP_EXCEEDED") return null;
  const currentCapUsd = Number(error.details?.currentCapUsd);
  const requiredEstimatedMaxUsd = Number(error.details?.requiredEstimatedMaxUsd);
  return {
    currentCapUsd: Number.isFinite(currentCapUsd) ? currentCapUsd : null,
    requiredEstimatedMaxUsd: Number.isFinite(requiredEstimatedMaxUsd) ? requiredEstimatedMaxUsd : null,
    actions: Array.isArray(error.actions) ? error.actions.filter((action): action is string => typeof action === "string") : [],
  };
}

function spendCapIssueMessage(issue: SpendCapIssue) {
  if (issue.currentCapUsd !== null && issue.requiredEstimatedMaxUsd !== null) {
    return `This plan's current conservative estimate is ${formatMoney(issue.requiredEstimatedMaxUsd)}, above your ${formatMoney(issue.currentCapUsd)} best-effort cap. No generation work started. Raise the cap or reduce the plan.`;
  }
  return "This plan is above your best-effort spend cap. No generation work started. Raise the cap or reduce the plan.";
}

function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const tooltipId = useId();
  return (
    <span className="ss-help-tip">
      <button type="button" aria-label={`Help: ${label}`} aria-describedby={tooltipId}>?</button>
      <span id={tooltipId} className="ss-help-tip__bubble" role="tooltip">{children}</span>
    </span>
  );
}

function ApiKeyGuide({ compact = false }: { compact?: boolean }) {
  const titleId = useId();
  return (
    <section className={`ss-api-key-guide${compact ? " ss-api-key-guide--compact" : ""}`} aria-labelledby={titleId}>
      <header>
        <div>
          <p className="ss-kicker">First-time OpenAI setup</p>
          <h3 id={titleId}>Get an API key in four careful steps.</h3>
          <p>
            An OpenAI API account is separate from a ChatGPT subscription. Even if you
            have ChatGPT Plus or Pro, API usage needs its own billing setup.
          </p>
        </div>
        <a
          href="https://platform.openai.com/settings/organization/api-keys"
          target="_blank"
          rel="noreferrer"
          aria-label="Open the OpenAI API keys page in a new tab"
        >
          Open API keys <span aria-hidden="true">↗</span>
        </a>
      </header>

      <ol className="ss-api-key-guide__steps">
        <li>
          <span>01</span>
          <div>
            <strong>Sign in to the API Platform</strong>
            <p>Open the API keys page in a new tab and sign in with your OpenAI account. Keep this Story Studio tab open.</p>
            <a href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noreferrer">Open OpenAI API Platform <span aria-hidden="true">↗</span></a>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Add API billing or credits</strong>
            <p>In Billing, add payment details and purchase a small prepaid balance. For a cautious first scroll, turn <em>Auto recharge</em> off.</p>
            <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">Open API billing <span aria-hidden="true">↗</span></a>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Create a dedicated secret key</strong>
            <p>If Projects are available, create or select one named “Story Scrolls.” Choose <em>+ Create new secret key</em>, name it “Story Scrolls,” and copy the complete key when OpenAI shows it.</p>
            <small>A dedicated project makes this key easy to monitor, rotate, or revoke without affecting your other work.</small>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Return here and paste once</strong>
            <p>Paste the value beginning with <code>sk-</code> into the field below. Do not enter your ChatGPT password. The studio clears the field before work starts and never saves the key.</p>
            <small>With AI illustrations, you will paste it once to prepare the visual guide and again—after approving that guide—for final production.</small>
          </div>
        </li>
      </ol>

      <aside className="ss-api-key-guide__guardrail">
        <span aria-hidden="true">!</span>
        <div>
          <strong>Choose a real spending guardrail.</strong>
          <p>
            OpenAI project budgets are soft alert thresholds: requests continue after
            the budget is crossed. For stronger practical protection, begin with a
            small prepaid balance and leave Auto recharge off. Billing cutoffs can be
            delayed, so still review the studio estimate before approving generation.
          </p>
          <div>
            <a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noreferrer">Set budget alerts <span aria-hidden="true">↗</span></a>
            <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">View API usage <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </aside>

      <details className="ss-api-key-guide__troubleshooting">
        <summary>Something not working? Check these first.</summary>
        <div>
          <article><strong>“Incorrect API key”</strong><p>Create a new secret key and copy the entire value without spaces. Revoke the old key if you may have exposed it.</p></article>
          <article><strong>“Insufficient quota” or billing error</strong><p>Add API credits, confirm the payment completed, then wait a few minutes for the new balance to become available.</p></article>
          <article><strong>Permission or model error</strong><p>Use a key from the correct project. If you chose Restricted permissions, allow the text, image, and moderation work this scroll requires.</p></article>
          <article><strong>Lost the secret value</strong><p>Create a replacement key, paste the new value here, and revoke the lost key.</p></article>
        </div>
      </details>

      <footer>
        <p>Never paste an API key into an email, support message, public document, or shared screenshot.</p>
        <a href="https://developers.openai.com/api/docs/quickstart" target="_blank" rel="noreferrer">OpenAI’s official API quickstart <span aria-hidden="true">↗</span></a>
      </footer>
    </section>
  );
}

function StudioGuide({
  dialogRef,
  step,
  stepIds,
  sourceLane,
  illustrationMode,
  isPictureBook,
  plannedChapters,
  visibleImages,
  hasCharacterBible,
  characterApproved,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  step: number;
  stepIds: readonly number[];
  sourceLane: SourceLane;
  illustrationMode: IllustrationMode;
  isPictureBook: boolean;
  plannedChapters: number;
  visibleImages: number;
  hasCharacterBible: boolean;
  characterApproved: boolean;
}) {
  const activeGuide = studioGuideForStep({
    step,
    sourceLane,
    illustrationMode,
    isPictureBook,
    plannedChapters,
    visibleImages,
    hasCharacterBible,
    characterApproved,
  });
  const displayedStep = Math.max(1, stepIds.indexOf(step) + 1);
  const sourceRoute = sourceLane === "gutenberg"
    ? "Verified public-domain edition"
    : sourceLane === "upload"
      ? "Creator-supplied manuscript"
      : "Original story workshop";
  const productionStages = illustrationMode === "ai"
    ? [
        ["Review", "Check the plan, visibility, current estimate, and request count."],
        ["Prepare", "Enter the key to make only the low-cost visual reference."],
        ["Approve", "Inspect and approve that exact continuity sheet—or revise the inputs."],
        ["Create", "Re-enter the cleared key and begin final text and illustration production."],
      ]
    : [
        ["Review", "Check the plan, visibility, uploaded-art coverage, and current estimate."],
        ["Authorize", "Confirm art rights, paste the key, and approve the stated API work."],
        ["Create", "Begin text production and artwork checks without a visual-guide pause."],
        ["Return", "Keep the recoverable job message; it is safe to leave once that appears."],
      ];
  return (
    <dialog
      ref={dialogRef}
      className="ss-studio-guide"
      aria-labelledby="ss-studio-guide-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="ss-studio-guide__panel">
        <header>
          <div>
            <p className="ss-kicker">A clear path from idea to scroll</p>
            <h2 id="ss-studio-guide-title">Studio guide</h2>
          </div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close studio guide">×</button>
        </header>

        <section className="ss-studio-guide__current" aria-live="polite">
          <span>Step {String(displayedStep).padStart(2, "0")} · {CREATOR_STEPS[step - 1]?.[0]}</span>
          <h3>{activeGuide.title}</h3>
          <p>{activeGuide.summary}</p>
          <dl>
            <div><dt>You will decide</dt><dd>{activeGuide.decision}</dd></div>
            <div><dt>Best result</dt><dd>{activeGuide.tip}</dd></div>
          </dl>
        </section>

        <section className="ss-studio-guide__screen" aria-labelledby="ss-studio-guide-screen">
          <div>
            <p className="ss-kicker">Finish this screen</p>
            <h3 id="ss-studio-guide-screen">A clear checklist for right now</h3>
            <ul>
              {activeGuide.checklist.map((item) => <li key={item}><span aria-hidden="true">✓</span><p>{item}</p></li>)}
            </ul>
          </div>
          <aside>
            <span>Then</span>
            <p>{activeGuide.next}</p>
          </aside>
        </section>

        <section className="ss-studio-guide__journey" aria-labelledby="ss-studio-guide-journey">
          <div className="ss-studio-guide__route">
            <div><span>Current route</span><strong>{sourceRoute}</strong></div>
            <small>{stepIds.length} screens{sourceLane === "gutenberg" ? " · verified catalog rights screen skipped" : ""}</small>
          </div>
          <p className="ss-kicker">The {stepIds.length === 5 ? "five" : "six"} screens</p>
          <h3 id="ss-studio-guide-journey">What the studio will ask</h3>
          <ol>
            {stepIds.map((itemStep, index) => {
              const [label, description] = CREATOR_STEPS[itemStep - 1];
              return (
              <li className={itemStep === step ? "is-current" : ""} key={label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{label}</strong><small>{description}</small></div>
              </li>
              );
            })}
          </ol>
        </section>

        <section className="ss-studio-guide__assurances" aria-labelledby="ss-studio-guide-assurances">
          <p className="ss-kicker">How production begins</p>
          <h3 id="ss-studio-guide-assurances">The final screen has deliberate pauses</h3>
          <div>
            {productionStages.map(([title, description], index) => (
              <article key={title}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><p>{description}</p></article>
            ))}
          </div>
        </section>

        <details className="ss-studio-guide__api-help">
          <summary><span>New to OpenAI API keys?</span><small>Open the complete first-time setup, spending, safety, and troubleshooting guide.</small></summary>
          <ApiKeyGuide compact />
        </details>

        <footer>
          <p>Your OpenAI key is used only for the request you approve and is never saved by the studio.</p>
          <a href="/about/#privacy">Read about privacy &amp; provenance <span aria-hidden="true">→</span></a>
        </footer>
      </div>
    </dialog>
  );
}

function StudioHeading({
  number,
  kicker,
  title,
  description,
  help,
}: {
  number: string;
  kicker: string;
  title: string;
  description?: string;
  help?: string;
}) {
  return (
    <div className="ss-create-panel__heading ss-create-panel__heading--guided">
      <span>{number}</span>
      <div>
        <p className="ss-kicker">{kicker}</p>
        <div className="ss-studio-heading__title">
          <h2>{title}</h2>
          {help ? <HelpTip label={title}>{help}</HelpTip> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  );
}

function StepActions({
  step,
  onBack,
  onNext,
  nextLabel = "Continue",
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="ss-studio-actions">
      {step > 1 ? <button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={onBack}>Back</button> : <span />}
      <button type="button" className="ss-studio-button ss-studio-button--gold" onClick={onNext}>
        {nextLabel} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function Choice({
  checked,
  name,
  value,
  title,
  description,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  name: string;
  value: string;
  title: string;
  description: string;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={checked ? "is-selected" : ""}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <strong>{title}</strong>
      <span>{description}</span>
    </label>
  );
}

function ReviewLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CreateStudio() {
  const formRef = useRef<HTMLFormElement>(null);
  const guideDialogRef = useRef<HTMLDialogElement>(null);
  const loadedGutenbergIdRef = useRef<number | null>(null);
  const pollingJobRef = useRef<string | null>(null);
  const pendingIdempotencyRef = useRef<string | null>(null);
  const [step, setStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(1);
  const [sourceLane, setSourceLane] = useState<SourceLane>("ai_original");
  const [uploadInputMode, setUploadInputMode] = useState<UploadInputMode>("file");
  const [rightsBasis, setRightsBasis] = useState<"own" | "public_domain" | "licensed">("own");
  const [visibility, setVisibility] = useState<Visibility>(CREATOR_AUTH_REQUIRED ? "private" : "unlisted");
  const [rewriteChoice, setRewriteChoice] = useState<RewriteChoice>("faithful");
  const [summaryLevel, setSummaryLevel] = useState<SummaryLevel>("balanced");
  const [audienceChoice, setAudienceChoice] = useState<AudienceChoice>("original");
  const [targetReaderAge, setTargetReaderAge] = useState(10);
  const [illustrationMode, setIllustrationMode] = useState<IllustrationMode>("ai");
  const [illustrationBudgetMode, setIllustrationBudgetMode] =
    useState<IllustrationBudgetMode>("total");
  const [illustrationBudgetCount, setIllustrationBudgetCount] = useState(13);
  const [flexibleAllocation, setFlexibleAllocation] = useState(true);
  const [targetChapters, setTargetChapters] = useState(6);
  const [targetWordsPerChapter, setTargetWordsPerChapter] = useState(900);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("automatic");
  const [qualityLevel, setQualityLevel] = useState<CraftLevel>(1);
  const [customQuality, setCustomQuality] = useState(false);
  const [writingTier, setWritingTier] = useState<WritingTier>("balanced");
  const [imageTier, setImageTier] = useState<ImageTier>("standard");
  const [refinementPasses, setRefinementPasses] = useState(0);
  const [outputSize, setOutputSize] = useState<"web" | "standard" | "retina">("standard");
  const [sourceCharacterCount, setSourceCharacterCount] = useState(0);
  const [manuscriptText, setManuscriptText] = useState("");
  const [manuscriptFile, setManuscriptFile] = useState<File | null>(null);
  const [illustrationFiles, setIllustrationFiles] = useState<File[]>([]);
  const [characterBible, setCharacterBible] = useState<CharacterBible | null>(null);
  const [characterApproval, setCharacterApproval] = useState<CharacterApproval | null>(null);
  const [legacyContinuityFallback, setLegacyContinuityFallback] = useState(false);
  const [status, setStatus] = useState<StudioStatus>("idle");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<CreateResult | null>(null);
  const [serverEstimate, setServerEstimate] = useState<ServerEstimate | null>(null);
  const [estimateApproval, setEstimateApproval] = useState<EstimateApproval | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<"idle" | "loading" | "error">("idle");
  const [spendCapEnabled, setSpendCapEnabled] = useState(true);
  const [spendCapUsd, setSpendCapUsd] = useState("");
  const [spendCapIssue, setSpendCapIssue] = useState<SpendCapIssue | null>(null);
  const [authState, setAuthState] = useState<"loading" | "signed_in" | "signed_out" | "error">(
    CREATOR_AUTH_REQUIRED ? "loading" : "signed_out",
  );
  const [creatorSession, setCreatorSession] = useState<CreatorSession | null>(null);
  const [loginUrl, setLoginUrl] = useState("/api/v2/auth/google?next=%2Fcreate%2F");
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [scrollTitle, setScrollTitle] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [originalAuthor, setOriginalAuthor] = useState("");
  const [sourceEdition, setSourceEdition] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState("");
  const [gutenbergReference, setGutenbergReference] = useState("");
  const [gutenbergQuery, setGutenbergQuery] = useState("");
  const [gutenbergBooks, setGutenbergBooks] = useState<GutenbergBook[]>([]);
  const [gutenbergStatus, setGutenbergStatus] = useState<"idle" | "searching" | "error">("idle");
  const [gutenbergMessage, setGutenbergMessage] = useState("");
  const [illuminatedSets, setIlluminatedSets] = useState<IlluminatedSet[]>(FALLBACK_ILLUMINATED_SETS);
  const [illuminatedStatus, setIlluminatedStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [illuminatedQuery, setIlluminatedQuery] = useState("");
  const [selectedIlluminatedId, setSelectedIlluminatedId] = useState(FALLBACK_ILLUMINATED_SETS[0].id);
  const [storyFont, setStoryFont] = useState("homemade-apple");
  const [visualStyle, setVisualStyle] = useState("warm storybook gouache");
  const [artDirection, setArtDirection] = useState("");
  const [continuityCharactersText, setContinuityCharactersText] = useState("");
  const [sourceVersions, setSourceVersions] = useState<SourceVersionMatch[]>([]);
  const [sourceVersionStatus, setSourceVersionStatus] = useState<"idle" | "searching" | "error">("idle");
  const [sourceVersionMessage, setSourceVersionMessage] = useState("");
  const [sourceVersionsDismissed, setSourceVersionsDismissed] = useState(false);

  const pollCreationJob = useCallback(async (jobId: string, signal?: AbortSignal) => {
    if (pollingJobRef.current === jobId) return;
    pollingJobRef.current = jobId;
    let transientFailures = 0;
    try {
      while (!signal?.aborted) {
        try {
          const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            signal,
          });
          const payload = (await response.json().catch(() => null)) as CreationJobEnvelope | null;
          if (!response.ok || !payload?.job) {
            throw new Error(payload?.error?.message || "The creation job could not be checked.");
          }
          transientFailures = 0;
          if (payload.job.status === "completed" && payload.result?.story) {
            window.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
            pendingIdempotencyRef.current = null;
            setCreated(payload.result.story);
            setMessage(payload.result.message || "Your scroll is ready.");
            setStatus("success");
            return;
          }
          if (payload.job.status === "failed") {
            window.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
            pendingIdempotencyRef.current = null;
            const capIssue = spendCapIssueFromError(payload.job.error);
            setSpendCapIssue(capIssue);
            setStatus("error");
            setMessage(
              payload.job.retryRequired
                ? "The server restarted before this scroll finished. Your key was not stored; re-enter it and submit again to retry."
                : capIssue
                  ? spendCapIssueMessage(capIssue)
                : creatorFacingCreationError(payload.job.error),
            );
            return;
          }
          setStatus("submitting");
          setMessage(
            payload.job.stage === "rendering-illustrations"
              ? "The story is written; the studio is rendering and checking its illustrations. You may safely leave and return."
              : "The studio is building and checking your scroll. You may safely leave and return.",
          );
        } catch {
          if (signal?.aborted) return;
          transientFailures += 1;
          if (transientFailures >= 8) {
            setStatus("error");
            setMessage("The connection was lost, but the job ID is saved in this tab. Reload to resume checking it.");
            return;
          }
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
      }
    } finally {
      if (pollingJobRef.current === jobId) pollingJobRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!CREATOR_AUTH_REQUIRED) return undefined;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/v2/auth/me", {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const result = (await response.json().catch(() => null)) as
          | CreatorSession
          | { loginUrl?: string; googleConfigured?: boolean; error?: { message?: string } }
          | null;
        if (!active) return;
        if (response.ok && result && "csrfToken" in result) {
          setCreatorSession(result);
          setAuthState("signed_in");
          return;
        }
        if (response.status === 401) {
          if (result && "loginUrl" in result && result.loginUrl) setLoginUrl(result.loginUrl);
          if (result && "googleConfigured" in result) setGoogleConfigured(Boolean(result.googleConfigured));
          setAuthState("signed_out");
          return;
        }
        setAuthState("error");
      } catch {
        if (active) setAuthState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (CREATOR_AUTH_REQUIRED && authState !== "signed_in") return undefined;
    let pending: { jobId?: string; idempotencyKey?: string } | null = null;
    try {
      pending = JSON.parse(window.sessionStorage.getItem(PENDING_CREATION_STORAGE_KEY) || "null");
    } catch {
      window.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
    }
    if (pending?.idempotencyKey) pendingIdempotencyRef.current = pending.idempotencyKey;
    if (!pending?.jobId || !UUID_PATTERN.test(pending.jobId)) return undefined;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setStatus("submitting");
      setMessage("Reconnecting to your in-progress scroll…");
      void pollCreationJob(pending.jobId!, controller.signal);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [authState, pollCreationJob]);

  useEffect(() => {
    if (sourceLane === "ai_original") return undefined;
    const gutenbergId = sourceLane === "gutenberg" ? parseGutenbergId(gutenbergReference) : null;
    if (!gutenbergId && (sourceTitle.trim().length < 3 || originalAuthor.trim().length < 2)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams();
      if (gutenbergId) parameters.set("gutenbergId", String(gutenbergId));
      if (sourceTitle.trim()) parameters.set("title", sourceTitle.trim());
      if (originalAuthor.trim()) parameters.set("author", originalAuthor.trim());
      setSourceVersionStatus("searching");
      setSourceVersionMessage("");
      void fetch(`/api/v2/source-versions?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => null)) as
            | { matches?: unknown[]; stories?: unknown[]; error?: { message?: string } }
            | null;
          if (!response.ok) throw new Error(result?.error?.message || "Existing versions could not be checked.");
          const raw = result?.matches ?? result?.stories ?? [];
          const matches = raw.map(normalizeSourceVersion).filter((item): item is SourceVersionMatch => Boolean(item));
          setSourceVersions(matches);
          setSourceVersionsDismissed(false);
          setSourceVersionStatus("idle");
          setSourceVersionMessage(matches.length ? "" : "No approved public versions of this source are on the shelf yet.");
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setSourceVersionStatus("error");
          setSourceVersionMessage(error instanceof Error ? error.message : "Existing versions could not be checked.");
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [gutenbergReference, originalAuthor, sourceLane, sourceTitle]);

  useEffect(() => {
    if (sourceLane !== "gutenberg") return undefined;
    const ebookId = parseGutenbergId(gutenbergReference);
    if (!ebookId || loadedGutenbergIdRef.current === ebookId) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/v1/gutenberg/books/${ebookId}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => null)) as
            | { book?: GutenbergBook; error?: { message?: string } }
            | null;
          if (!response.ok || !result?.book) {
            throw new Error(result?.error?.message || "That catalog record could not be loaded.");
          }
          const book = result.book;
          loadedGutenbergIdRef.current = book.id;
          setSourceTitle(book.title);
          setOriginalAuthor(book.authors.join(", ") || "Author not listed");
          setScrollTitle((current) => current.trim() ? current : book.title);
          setSourceEdition("Public-domain UTF-8 source edition");
          setOriginalLanguage(book.languages.map(languageLabel).join(", ") || "Language not listed");
          setGutenbergStatus("idle");
          setGutenbergMessage(`Source details filled automatically for eBook #${book.id}.`);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setGutenbergStatus("error");
          setGutenbergMessage(error instanceof Error ? error.message : "That catalog record could not be loaded.");
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [gutenbergReference, sourceLane]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/v2/illuminated-sets", {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const result = (await response.json().catch(() => null)) as { sets?: unknown[] } | null;
        const sets = result?.sets?.map(normalizeIlluminatedSet).filter((item): item is IlluminatedSet => Boolean(item)) ?? [];
        if (!response.ok || !sets.length) throw new Error("catalog unavailable");
        sets.sort((left, right) =>
          left.family.localeCompare(right.family) || left.displayName.localeCompare(right.displayName),
        );
        if (!active) return;
        setIlluminatedSets(sets);
        setSelectedIlluminatedId((current) => sets.some((item) => item.id === current) ? current : sets[0].id);
        setIlluminatedStatus("ready");
      } catch {
        if (active) setIlluminatedStatus("fallback");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isPictureBook = audienceChoice === "picture_book";
  const automaticScope = useMemo(
    () => automaticStoryScope({
      sourceLane,
      sourceCharacters: sourceCharacterCount,
      rewriteChoice,
      summaryLevel,
      audienceChoice,
      targetReaderAge,
    }),
    [audienceChoice, rewriteChoice, sourceCharacterCount, sourceLane, summaryLevel, targetReaderAge],
  );
  const plannedChapters = scopeMode === "automatic" ? automaticScope.chapters : targetChapters;
  const plannedWordsPerChapter = scopeMode === "automatic" ? automaticScope.wordsPerChapter : targetWordsPerChapter;
  const craftProfile = CRAFT_PROFILES[qualityLevel];
  const minimumTotalImages = 1 + requiredInteriorCount(plannedChapters);
  const effectiveBudgetCount = illustrationBudgetMode === "total"
    ? Math.max(minimumTotalImages, illustrationBudgetCount)
    : Math.max(2, illustrationBudgetCount);
  const illustrationDensity = legacyDensityForBudget(
    plannedChapters,
    illustrationBudgetMode,
    effectiveBudgetCount,
  );
  const aiCounts = illustrationCounts(
    plannedChapters,
    illustrationBudgetMode,
    effectiveBudgetCount,
  );
  const currentImagesPerChapter = illustrationBudgetMode === "per_chapter"
    ? Math.max(2, Math.min(8, effectiveBudgetCount))
    : Math.max(2, Math.min(8, Math.round((effectiveBudgetCount - 1) / Math.max(1, plannedChapters))));
  const estimatedCondensationCalls =
    rewriteChoice === "summary" && sourceCharacterCount > DIRECT_SOURCE_CHARACTERS
      ? Math.ceil(sourceCharacterCount / SUMMARY_CHUNK_CHARACTERS)
      : 0;
  const estimatedTextRequests = 1 + estimatedCondensationCalls + refinementPasses;
  const recommendedImagesPerChapter = targetReaderAge <= 5 ? 4 : targetReaderAge <= 8 ? 3 : 2;
  const recommendedImageCount = 1 + plannedChapters * recommendedImagesPerChapter;
  const costEstimate = useMemo(
    () => estimateCost({
      sourceCharacters: sourceCharacterCount,
      targetWords: plannedChapters * plannedWordsPerChapter,
      textRequests: estimatedTextRequests,
      visibleImages: illustrationMode === "ai" ? aiCounts.visible : 0,
      writingTier,
      imageTier,
    }),
    [
      aiCounts.visible,
      estimatedTextRequests,
      illustrationMode,
      imageTier,
      sourceCharacterCount,
      plannedChapters,
      plannedWordsPerChapter,
      writingTier,
    ],
  );
  const displayedEstimate = serverEstimate
    ? { minimum: serverEstimate.estimatedMinUsd, maximum: serverEstimate.estimatedMaxUsd }
    : costEstimate;
  const displayedCatalogVersion = serverEstimate?.catalogVersion || COST_CATALOG_VERSION;
  const selectedIlluminatedSet = illuminatedSets.find((item) => item.id === selectedIlluminatedId)
    ?? illuminatedSets[0];
  const suggestedArt = artStyleSuggestions(
    audienceChoice === "original" ? 18 : targetReaderAge,
    isPictureBook,
  );
  const visibleIlluminatedSets = useMemo(() => {
    const query = illuminatedQuery.trim().toLocaleLowerCase();
    if (!query) return illuminatedSets;
    return illuminatedSets.filter((item) =>
      `${item.displayName} ${item.family} ${item.description}`.toLocaleLowerCase().includes(query),
    );
  }, [illuminatedQuery, illuminatedSets]);
  const visibleStepIds = sourceLane === "gutenberg"
    ? ([1, 3, 4, 5, 6] as const)
    : ([1, 2, 3, 4, 5, 6] as const);
  const displayedStep = Math.max(1, visibleStepIds.indexOf(step as never) + 1);
  const displayedSectionNumber = (sectionStep: number) => {
    const visibleIndex = (visibleStepIds as readonly number[]).indexOf(sectionStep);
    return String(visibleIndex >= 0 ? visibleIndex + 1 : sectionStep).padStart(2, "0");
  };

  const rightsHelp = useMemo(() => {
    if (sourceLane === "gutenberg") return "This lane records the exact source edition and its public-domain notice.";
    if (sourceLane === "ai_original") return "You are directing a new story rather than importing someone else’s text.";
    if (rightsBasis === "own") return "You wrote this story or control the rights needed to adapt it.";
    if (rightsBasis === "public_domain") return "Name the edition and provide a source supporting its public-domain status.";
    return "Describe the permission or license and include its source link.";
  }, [rightsBasis, sourceLane]);

  const clearCharacterReview = () => {
    setCharacterBible(null);
    setCharacterApproval(null);
    setLegacyContinuityFallback(false);
  };

  const signOut = async () => {
    if (!creatorSession) return;
    try {
      const response = await fetch("/api/v2/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": creatorSession.csrfToken },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign out failed");
      setCreatorSession(null);
      setAuthState("signed_out");
      setStep(1);
      setFurthestStep(1);
      clearCharacterReview();
    } catch {
      setMessage("Refresh the page and try signing out again.");
      setStatus("error");
    }
  };

  const changeSourceLane = (lane: SourceLane) => {
    setSourceLane(lane);
    if (lane === "ai_original") setRightsBasis("own");
    if (lane === "gutenberg") setRightsBasis("public_domain");
    setRewriteChoice("faithful");
    setSourceCharacterCount(0);
    setManuscriptText("");
    setManuscriptFile(null);
    setSourceTitle("");
    setOriginalAuthor("");
    setSourceEdition(lane === "upload" ? "Creator-supplied manuscript" : lane === "gutenberg" ? "Public-domain UTF-8 source edition" : "");
    setOriginalLanguage("");
    loadedGutenbergIdRef.current = null;
    setGutenbergReference("");
    setGutenbergBooks([]);
    setGutenbergMessage("");
    setSourceVersions([]);
    setSourceVersionMessage("");
    setSourceVersionsDismissed(false);
    clearCharacterReview();
  };

  const searchGutenberg = async () => {
    const query = gutenbergQuery.trim();
    if (query.length < 2) {
      setGutenbergStatus("error");
      setGutenbergMessage("Enter at least two letters from a title or author.");
      return;
    }
    setGutenbergStatus("searching");
    setGutenbergMessage("");
    try {
      const response = await fetch(`/api/v1/gutenberg/search?q=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const result = (await response.json().catch(() => null)) as
        | { books?: GutenbergBook[]; error?: { message?: string } }
        | null;
      if (!response.ok || !Array.isArray(result?.books)) {
        throw new Error(result?.error?.message || "The public-domain catalog is unavailable.");
      }
      setGutenbergBooks(result.books);
      setGutenbergStatus("idle");
      setGutenbergMessage(result.books.length
        ? `${result.books.length} matches. Choose the edition you want.`
        : "No matches yet. Try fewer words or an author surname.");
    } catch (error) {
      setGutenbergStatus("error");
      setGutenbergMessage(error instanceof Error ? error.message : "The public-domain catalog is unavailable.");
    }
  };

  const chooseGutenbergBook = (book: GutenbergBook) => {
    loadedGutenbergIdRef.current = book.id;
    setGutenbergReference(String(book.id));
    setSourceTitle(book.title);
    setOriginalAuthor(book.authors.join(", ") || "Unknown");
    setSourceEdition("Public-domain UTF-8 source edition");
    setOriginalLanguage(book.languages.map(languageLabel).join(", ") || "Language not listed");
    setScrollTitle((current) => current.trim() ? current : book.title);
    setGutenbergMessage(`Selected eBook #${book.id}. Its canonical source and edition will be credited automatically.`);
  };

  const chooseAudience = (choice: AudienceChoice) => {
    setAudienceChoice(choice);
    if (choice !== "picture_book") return;
    setIllustrationMode("ai");
    setIllustrationBudgetMode("total");
    setFlexibleAllocation(true);
    setTargetReaderAge((age) => Math.min(age, 8));
    setIllustrationBudgetCount((count) => Math.max(count, 1 + plannedChapters * 3));
  };

  const chooseCraftLevel = (level: CraftLevel) => {
    const profile = CRAFT_PROFILES[level];
    setQualityLevel(level);
    setCustomQuality(false);
    setWritingTier(profile.writingTier);
    setImageTier(profile.imageTier);
    setRefinementPasses(profile.refinementPasses);
    setOutputSize(profile.outputSize);
    setIllustrationMode("ai");
    setIllustrationBudgetMode("total");
    setFlexibleAllocation(true);
    setIllustrationBudgetCount(1 + plannedChapters * profile.imagesPerChapter);
  };

  const chooseWritingCraft = (index: number) => {
    setWritingTier((["economy", "balanced", "literary"] as const)[index] ?? "balanced");
    setCustomQuality(true);
  };

  const chooseArtFidelity = (index: number) => {
    setImageTier((["draft", "standard", "premium"] as const)[index] ?? "standard");
    setCustomQuality(true);
  };

  const chooseOutputSize = (index: number) => {
    setOutputSize((["web", "standard", "retina"] as const)[index] ?? "standard");
    setCustomQuality(true);
  };

  const chooseIllustrationFrequency = (imagesPerChapter: number) => {
    setIllustrationMode("ai");
    setIllustrationBudgetMode("total");
    setIllustrationBudgetCount(1 + plannedChapters * imagesPerChapter);
    setFlexibleAllocation(true);
    setCustomQuality(true);
  };

  const moveToStep = (next: number) => {
    setStep(next);
    setFurthestStep((current) => Math.max(current, next));
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const openStudioGuide = () => {
    if (!guideDialogRef.current?.open) guideDialogRef.current?.showModal();
  };

  const fail = (text: string, targetStep?: number) => {
    setMessage(text);
    setStatus("error");
    if (targetStep) moveToStep(targetStep);
    return false;
  };

  const currentPanelIsValid = (panelStep: number) => {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-creator-step="${panelStep}"]`);
    const required = panel?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[required]");
    for (const control of required ?? []) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    if (panelStep === 1) {
      const data = new FormData(formRef.current!);
      if (sourceLane === "upload" && uploadInputMode === "file" && !manuscriptFile) {
        return fail("Choose a .txt or .md manuscript file, or switch to paste text.");
      }
      if (sourceLane === "upload" && uploadInputMode === "paste" && field(data, "sourceText").length < 80) {
        return fail("Paste at least 80 characters of source text.");
      }
      if (sourceLane === "gutenberg" && !parseGutenbergId(field(data, "gutenbergReference"))) {
        return fail("Enter a valid public-domain eBook number or source URL.");
      }
    }
    if (panelStep === 5 && illustrationMode === "ai") {
      const names = parseContinuityCharacters(continuityCharactersText);
      const uniqueNames = new Set(names.map((name) => name.toLocaleLowerCase("en-US")));
      if (names.length > 8) return fail("List no more than 8 exact continuity characters.");
      if (names.some((name) => name.length > 100)) return fail("Each continuity character name must be 100 characters or fewer.");
      if (uniqueNames.size !== names.length) return fail("List each continuity character only once.");
    }
    return true;
  };

  const next = () => {
    setStatus("idle");
    setMessage("");
    if (!currentPanelIsValid(step)) return;
    const currentIndex = visibleStepIds.indexOf(step as never);
    moveToStep(visibleStepIds[Math.min(visibleStepIds.length - 1, currentIndex + 1)] ?? step);
  };

  const validateIllustrationUploads = () => {
    if (illustrationMode !== "upload") return true;
    if (!illustrationFiles.length || illustrationFiles.length > MAX_ILLUSTRATION_FILES) {
      return fail(`Choose between 1 and ${MAX_ILLUSTRATION_FILES} illustration files.`, 5);
    }
    const totalBytes = illustrationFiles.reduce((sum, file) => sum + file.size, 0);
    const invalidFile = illustrationFiles.find(
      (file) =>
        !ILLUSTRATION_NAME_PATTERN.test(file.name) ||
        !ILLUSTRATION_TYPES.has(file.type) ||
        file.size > MAX_ILLUSTRATION_FILE_BYTES,
    );
    if (invalidFile) return fail(`${invalidFile.name} does not match the placement name, format, or 6 MB file limit.`, 5);
    if (totalBytes > MAX_ILLUSTRATION_TOTAL_BYTES) return fail("The illustration set must be 40 MB or smaller in total.", 5);
    if (!illustrationFiles.some((file) => file.name.startsWith("000__cover__"))) {
      return fail("Your illustration set needs one 000__cover__… image.", 5);
    }
    for (let chapter = 1; chapter <= plannedChapters; chapter += 1) {
      const marker = `__ch${String(chapter).padStart(2, "0")}`;
      const chapterFiles = illustrationFiles.filter((file) => file.name.includes(marker));
      if (!chapterFiles.some((file) => file.name.includes("-hero__"))) {
        return fail(`Chapter ${chapter} needs one chapter-hero image.`, 5);
      }
      if (!chapterFiles.some((file) => file.name.includes("-pct"))) {
        return fail(`Chapter ${chapter} needs at least one inline image.`, 5);
      }
    }
    return true;
  };

  const collectPayload = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const gutenbergId = sourceLane === "gutenberg"
      ? parseGutenbergId(field(data, "gutenbergReference"))
      : null;
    const pastedText = sourceLane === "upload" && uploadInputMode === "paste"
      ? field(data, "sourceText")
      : "";
    const sourceText = sourceLane === "upload"
      ? (uploadInputMode === "file" ? manuscriptText : pastedText)
      : undefined;
    const creativeBrief = sourceLane === "ai_original"
      ? originalStoryBrief(data)
      : field(data, "adaptationBrief") || undefined;
    const originalAuthor = sourceLane === "ai_original"
      ? field(data, "authorDisplayName")
      : field(data, "originalAuthor");
    const sourceTitle = sourceLane === "ai_original"
      ? field(data, "title")
      : field(data, "sourceTitle");
    const canonicalGutenbergUrl = gutenbergId
      ? `https://www.gutenberg.org/ebooks/${gutenbergId}`
      : null;
    const suppliedSourceUrls = field(data, "sourceUrls")
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    const sourceUrls = [...new Set([
      ...(canonicalGutenbergUrl ? [canonicalGutenbergUrl] : []),
      ...suppliedSourceUrls,
    ])];
    const delimiters = ["square", "angle", "round"].filter(
      (delimiter) => data.get(`cleanup-${delimiter}`) === "on",
    );
    const changeDescription = field(data, "changeDescription") ||
      (sourceLane === "ai_original"
        ? "Original story developed with the creator’s premise, arc, characters, theme, and planned ending."
        : transformationDescription(rewriteChoice, data));
    const transformation = {
      mode: rewriteChoice === "summary" ? "summary" : "faithful",
      intent: rewriteChoice,
      summaryLevel,
      targetLanguage: rewriteChoice === "translate" ? field(data, "targetLanguage") : null,
      modernization: rewriteChoice === "modernize" ? field(data, "modernization") || "full" : "none",
      reimagination: {
        enabled: rewriteChoice === "reimagine" || rewriteChoice === "alternate_ending",
        setting: rewriteChoice === "reimagine" ? field(data, "reimaginedSetting") || undefined : undefined,
        characterChanges: rewriteChoice === "reimagine" ? field(data, "characterChanges") || undefined : undefined,
        plotChanges: rewriteChoice === "reimagine" ? field(data, "reimaginationNotes") || undefined : undefined,
        alternateEnding: rewriteChoice === "alternate_ending" ? field(data, "alternateEnding") || undefined : undefined,
      },
    };
    const audience = {
      targetAge: audienceChoice === "original" ? null : targetReaderAge,
      format: isPictureBook ? "picture_book" : "prose",
    };
    const continuityCharacters = parseContinuityCharacters(
      field(data, "continuityCharacters"),
    );
    const sourceKind = sourceLane === "ai_original"
      ? "brief"
      : sourceLane === "gutenberg"
        ? "gutenberg"
        : uploadInputMode === "file"
          ? "upload"
          : "pasted";
    const sourceMetadata = {
      lane: sourceLane,
      sourceTitle: sourceTitle || undefined,
      originalAuthor: originalAuthor || undefined,
      edition: sourceEdition || field(data, "sourceEdition") || (gutenbergId ? "Public-domain UTF-8 source edition" : undefined),
      originalLanguage: originalLanguage || field(data, "originalLanguage") || undefined,
      canonicalUrl: canonicalGutenbergUrl || sourceUrls[0] || undefined,
      gutenbergId: gutenbergId || undefined,
      changeDescription,
    };
    const payload = {
      authorDisplayName: field(data, "authorDisplayName"),
      creatorName: field(data, "authorDisplayName"),
      title: field(data, "title") || sourceTitle || undefined,
      creativeBrief,
      sourceText: sourceText || undefined,
      source: {
        kind: sourceKind,
        gutenbergId: gutenbergId || undefined,
      },
      sourceMetadata,
      rights: {
        basis: sourceLane === "gutenberg" ? "public_domain" : rightsBasis,
        confirmed: sourceLane === "gutenberg" || data.get("rightsConfirmed") === "on",
        artConfirmed: illustrationMode === "upload" ? data.get("artRightsConfirmed") === "on" : true,
        artCredit: illustrationMode === "upload" ? field(data, "artCredit") || undefined : undefined,
        statement: sourceLane === "gutenberg"
          ? "Imported from an established public-domain source archive."
          : field(data, "rightsStatement") || undefined,
        sourceUrls: sourceUrls.length ? sourceUrls : undefined,
      },
      sharing: {
        visibility,
        requestPublic: visibility === "public",
      },
      generation: {
        confirmed: data.get("generationConfirmed") === "on",
        targetChapters: plannedChapters,
        targetWordsPerChapter: plannedWordsPerChapter,
        scopeMode,
        qualityLevel,
        customQuality: customQuality
          ? { writingTier, refinementPasses, imageTier, outputSize }
          : undefined,
        writingTier,
        imageTier,
        refinementPasses,
        outputSize,
        estimateApproval:
          data.get("generationConfirmed") === "on" && estimateApproval
            ? estimateApproval
            : undefined,
        spendCapUsd: spendCapEnabled ? parseSpendCap(spendCapUsd) ?? undefined : undefined,
        transformation,
        audience,
        visualStyle,
        artDirection: artDirection || undefined,
        continuityCharacters: continuityCharacters.length ? continuityCharacters : undefined,
        fontFamily: storyFont,
        themeId: field(data, "themeId") || "manuscript",
        illuminatedSetId: selectedIlluminatedId,
        cleanup: { leadingNoteDelimiters: delimiters },
        characterBibleApproval: characterApproval?.token
          ? { id: characterApproval.id, token: characterApproval.token }
          : undefined,
        illustrations: {
          mode: illustrationMode,
          density: illustrationMode === "ai" ? illustrationDensity : undefined,
          quality: imageTier,
          requiredAssets: {
            cover: 1,
            chapterHeroesPerChapter: 1,
            inlinePerChapter: 1,
          },
          budget: illustrationMode === "ai"
            ? {
                mode: illustrationBudgetMode,
                count: effectiveBudgetCount,
                includesCover: illustrationBudgetMode === "total",
                flexibleAllocation: illustrationBudgetMode === "total" ? flexibleAllocation : false,
              }
            : undefined,
        },
      },
    };
    return { data, payload, sourceText, sourceUrls };
  };

  const openReviewWithEstimate = async () => {
    setStatus("idle");
    setMessage("");
    setSpendCapIssue(null);
    if (!currentPanelIsValid(5) || !formRef.current) return;
    setSpendCapUsd((current) => current.trim() || recommendedSpendCap(costEstimate.maximum).toFixed(2));
    moveToStep(6);
    setEstimateStatus("loading");
    setServerEstimate(null);
    setEstimateApproval(null);
    try {
      const { payload } = await collectPayload(formRef.current);
      const response = await fetch("/api/v1/estimates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(creatorSession ? { "X-CSRF-Token": creatorSession.csrfToken } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as
        | { estimate?: ServerEstimate; approval?: EstimateApproval; error?: { message?: string } }
        | null;
      if (!response.ok || !result?.estimate || !result.approval) {
        throw new Error(result?.error?.message || "The cost estimate could not be prepared.");
      }
      setServerEstimate(result.estimate);
      setEstimateApproval(result.approval);
      setSpendCapUsd((current) => {
        const currentCap = parseSpendCap(current);
        return currentCap !== null && currentCap >= result.estimate!.estimatedMaxUsd
          ? current
          : recommendedSpendCap(result.estimate!.estimatedMaxUsd).toFixed(2);
      });
      setEstimateStatus("idle");
    } catch (error) {
      setEstimateStatus("error");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The cost estimate could not be prepared.");
    }
  };

  const validateForGeneration = async (form: HTMLFormElement) => {
    const collected = await collectPayload(form);
    const { data, payload, sourceText, sourceUrls } = collected;
    if (!payload.authorDisplayName) return fail("Add the creator name or pen name that should appear on the title page.", 1) ? null : null;
    if (sourceLane === "ai_original") {
      const requiredFields = [
        "premise",
        "protagonist",
        "characterDesire",
        "characterNeed",
        "centralConflict",
        "stakes",
        "incitingTurn",
        "midpointTurn",
        "climaxChoice",
        "characterArc",
        "themeLesson",
        "plannedEnding",
      ];
      if (requiredFields.some((name) => field(data, name).length < 12)) {
        fail("Complete the workshop so the character’s want and need, conflict, stakes, three-act turns, arc, theme, and ending can guide the draft.", 1);
        return null;
      }
    }
    if (sourceLane === "upload") {
      if (uploadInputMode === "file" && !manuscriptFile) {
        fail("Choose a .txt or .md manuscript file.", 1);
        return null;
      }
      if ((sourceText?.length ?? 0) < 80) {
        fail("The manuscript needs at least 80 characters.", 1);
        return null;
      }
    }
    if (sourceLane === "gutenberg" && !payload.source.gutenbergId) {
      fail("Enter a valid public-domain eBook number or source URL.", 1);
      return null;
    }
    if (rewriteChoice === "summary" && sourceLane === "ai_original") {
      fail("Story-digest mode is for imported books. Use the story workshop to plan a shorter original instead.", 3);
      return null;
    }
    if (
      rewriteChoice !== "summary" &&
      sourceLane === "upload" &&
      (sourceText?.length ?? 0) > DIRECT_SOURCE_CHARACTERS
    ) {
      fail("Sources longer than 240,000 characters need Story-digest mode so they can be processed in careful sections.", 3);
      return null;
    }
    if (sourceUrls.length > MAX_SOURCE_URLS || sourceUrls.some((url) => !isValidHttpsUrl(url))) {
      fail(`Use no more than ${MAX_SOURCE_URLS} valid HTTPS source links without embedded credentials.`, 2);
      return null;
    }
    if (rightsBasis !== "own" && sourceUrls.length === 0) {
      fail("Public-domain and licensed material needs at least one supporting source link.", 2);
      return null;
    }
    if (sourceLane !== "gutenberg" && !payload.rights.confirmed) {
      fail("Confirm that you have the right to submit and transform this material.", 2);
      return null;
    }
    if (data.get("generationConfirmed") !== "on" || !estimateApproval) {
      fail("Review and approve the estimated API work before continuing.", 6);
      return null;
    }
    if (spendCapEnabled) {
      const cap = parseSpendCap(spendCapUsd);
      if (cap === null) {
        fail("Enter a best-effort spend cap between $0.01 and $10,000, or turn the optional cap off.", 6);
        return null;
      }
      if (serverEstimate && cap + Number.EPSILON < serverEstimate.estimatedMaxUsd) {
        setSpendCapIssue({
          currentCapUsd: cap,
          requiredEstimatedMaxUsd: serverEstimate.estimatedMaxUsd,
          actions: ["increase_cap", "reduce_quality_or_art"],
        });
        fail(`Your ${formatMoney(cap)} cap is below this plan's ${formatMoney(serverEstimate.estimatedMaxUsd)} conservative estimate. Raise the cap or reduce quality or art quantity.`, 6);
        return null;
      }
    }
    if (!validateIllustrationUploads()) return null;
    return collected;
  };

  const clearKey = (form: HTMLFormElement) => {
    const keyInput = form.elements.namedItem("apiKey") as HTMLInputElement | null;
    const apiKey = keyInput?.value.trim() ?? "";
    if (keyInput) keyInput.value = "";
    return apiKey;
  };

  const prepareCharacterBible = async (
    form: HTMLFormElement,
    apiKey: string,
    collected: Awaited<ReturnType<typeof collectPayload>>,
  ) => {
    setStatus("preparing");
    setMessage("Building a reviewable character and style guide. Your key has already been cleared from the form.");
    const { payload, sourceText } = collected;
    const response = await fetch("/api/v1/character-bibles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(creatorSession ? { "X-CSRF-Token": creatorSession.csrfToken } : {}),
      },
      body: JSON.stringify({
        creativeBrief: payload.creativeBrief,
        sourceText: sourceText || undefined,
        source: payload.source,
        sourceMetadata: payload.sourceMetadata,
        rights: payload.rights,
        visualStyle: payload.generation.visualStyle,
        artDirection: payload.generation.artDirection,
        generation: {
          writingTier,
          continuityCharacters: payload.generation.continuityCharacters,
          spendCapUsd: payload.generation.spendCapUsd,
        },
        audience: payload.generation.audience,
        transformation: payload.generation.transformation,
      }),
    });
    if (response.status === 404 || response.status === 501) {
      setLegacyContinuityFallback(true);
      setStatus("idle");
      setMessage("This server does not yet support a separate character-guide checkpoint. You can explicitly accept the inline continuity fallback, or wait until staged review is available.");
      return;
    }
    const result = (await response.json().catch(() => null)) as
      | { characterBible?: CharacterBible; error?: { message?: string } }
      | null;
    if (!response.ok || !result?.characterBible) {
      throw new Error(result?.error?.message || "The character guide could not be prepared.");
    }
    setCharacterBible(result.characterBible);
    setCharacterApproval(null);
    setStatus("idle");
    setMessage("Review the visual reference sheet and written guide below. This exact sheet will guide every final illustration only after you approve it.");
    requestAnimationFrame(() => form.querySelector(".ss-character-review")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const approveCharacterBible = async () => {
    if (!characterBible) return;
    setStatus("approving");
    setMessage("Recording your approval…");
    try {
      const response = await fetch(`/api/v1/character-bibles/${encodeURIComponent(characterBible.id)}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(creatorSession ? { "X-CSRF-Token": creatorSession.csrfToken } : {}),
        },
        body: JSON.stringify({ approved: true }),
      });
      const result = (await response.json().catch(() => null)) as
        | { approval?: CharacterApproval; characterBible?: CharacterBible; error?: { message?: string } }
        | null;
      if (!response.ok || !result?.approval) {
        throw new Error(result?.error?.message || "The character guide approval could not be recorded.");
      }
      setCharacterApproval(result.approval);
      if (result.characterBible) setCharacterBible(result.characterBible);
      setStatus("idle");
      setMessage("Visual reference approved. Re-enter your API key to begin final production; the approved sheet will be reused rather than replaced.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The character guide approval could not be recorded.");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setCreated(null);
    setSpendCapIssue(null);
    const collected = await validateForGeneration(form);
    if (!collected) return;
    const apiKey = clearKey(form);
    if (!apiKey) {
      fail("Enter an OpenAI API key. It will be used only for this request and cleared before work starts.", 6);
      (form.elements.namedItem("apiKey") as HTMLInputElement | null)?.focus();
      return;
    }

    try {
      if (illustrationMode === "ai" && !characterApproval && !legacyContinuityFallback) {
        await prepareCharacterBible(form, apiKey, collected);
        return;
      }
      if (illustrationMode === "ai" && legacyContinuityFallback && !characterApproval) {
        setStatus("error");
        setMessage("Accept the inline continuity fallback before starting final generation.");
        return;
      }
      setStatus("submitting");
      setMessage("Your key is active only in this generation job’s temporary memory and has already been cleared from the form. It is never written to storage.");
      const { payload } = await collectPayload(form);
      const requestHeaders: HeadersInit = { Authorization: `Bearer ${apiKey}` };
      if (creatorSession) requestHeaders["X-CSRF-Token"] = creatorSession.csrfToken;
      const idempotencyKey = pendingIdempotencyRef.current || globalThis.crypto.randomUUID();
      pendingIdempotencyRef.current = idempotencyKey;
      requestHeaders["Idempotency-Key"] = idempotencyKey;
      window.sessionStorage.setItem(
        PENDING_CREATION_STORAGE_KEY,
        JSON.stringify({ idempotencyKey }),
      );
      const makeRequestBody = (): BodyInit => {
        if (manuscriptFile || illustrationMode === "upload") {
          const multipart = new FormData();
          multipart.append("request", JSON.stringify(payload));
          if (manuscriptFile) multipart.append("manuscript", manuscriptFile, manuscriptFile.name);
          illustrationFiles.forEach((file) => multipart.append("illustrations", file, file.name));
          return multipart;
        }
        requestHeaders["Content-Type"] = "application/json";
        return JSON.stringify(payload);
      };
      let response: Response | null = null;
      let connectionError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch("/api/v1/stories", {
            method: "POST",
            headers: requestHeaders,
            body: makeRequestBody(),
            credentials: "same-origin",
          });
          break;
        } catch (error) {
          connectionError = error;
          if (attempt === 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
          }
        }
      }
      if (!response) throw connectionError || new Error("The creation request could not be delivered.");
      const result = (await response.json().catch(() => null)) as CreationJobEnvelope | null;
      if (!response.ok) {
        if (response.status === 409) {
          pendingIdempotencyRef.current = null;
          window.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
        }
        const capIssue = spendCapIssueFromError(result?.error);
        if (capIssue) {
          setSpendCapIssue(capIssue);
          throw new Error(spendCapIssueMessage(capIssue));
        }
        throw new Error(creatorFacingCreationError(result?.error));
      }
      if (result?.story) {
        pendingIdempotencyRef.current = null;
        window.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
        setCreated(result.story);
        setMessage(result.message || "Your scroll is ready.");
        setStatus("success");
        return;
      }
      if (!result?.job?.id || !UUID_PATTERN.test(result.job.id)) {
        throw new Error("The server accepted the request without a recoverable job ID.");
      }
      window.sessionStorage.setItem(
        PENDING_CREATION_STORAGE_KEY,
        JSON.stringify({ idempotencyKey, jobId: result.job.id }),
      );
      setMessage(result.message || "Your scroll is underway. You may safely leave this page and return.");
      setStatus("submitting");
      void pollCreationJob(result.job.id);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The scroll could not be created.");
    }
  };

  return (
    <main className="ss-platform ss-create-page">
      <PlatformHeader />
      <section className="ss-create-hero ss-create-hero--guided">
        <div>
          <p className="ss-kicker">Story studio</p>
          <h1>Make a story worth wandering through.</h1>
          <p>
            Bring your manuscript, a public-domain classic, or the beginning of an idea.
            The Story Studio helps shape the telling, then pauses for your approval
            before creating the complete illustrated scroll.
          </p>
        </div>
        <div className="ss-create-hero__promise" role="note">
          <span aria-hidden="true">✦</span>
          <p><strong>Your key remains yours.</strong> It is never saved in browser storage or a story record.</p>
        </div>
      </section>

      <StudioGuide
        dialogRef={guideDialogRef}
        step={step}
        stepIds={visibleStepIds}
        sourceLane={sourceLane}
        illustrationMode={illustrationMode}
        isPictureBook={isPictureBook}
        plannedChapters={plannedChapters}
        visibleImages={aiCounts.visible}
        hasCharacterBible={Boolean(characterBible)}
        characterApproved={Boolean(characterApproval)}
      />

      {CREATOR_AUTH_REQUIRED && (authState !== "signed_in" || !creatorSession) ? (
        <section className="ss-creator-gate" aria-live="polite">
          <span aria-hidden="true">{authState === "loading" ? "S" : "✦"}</span>
          <p className="ss-kicker">Stage 00 · Your workbench</p>
          <h2>{authState === "loading" ? "Opening the creator studio…" : authState === "error" ? "The studio door did not open." : "Sign in to begin a scroll."}</h2>
          <p>
            {authState === "loading"
              ? "Checking for your private creator session."
              : authState === "error"
                ? "The account service could not be reached. Refresh the page to try again."
                : googleConfigured
                  ? "Google sign-in protects private drafts, remembers which scrolls are yours, and enforces the public-shelf allowance. It never replaces your OpenAI API key."
                  : "Google sign-in is not configured on this environment yet. An administrator must finish the creator-account setup before new scrolls can be made."}
          </p>
          {authState === "signed_out" && googleConfigured ? (
            <a className="ss-studio-button ss-studio-button--gold" href={loginUrl}>Continue with Google <span aria-hidden="true">→</span></a>
          ) : authState === "error" ? (
            <button className="ss-studio-button ss-studio-button--quiet" type="button" onClick={() => window.location.reload()}>Try again</button>
          ) : null}
          <small>Your Google session and CSRF protection remain in secure same-site session handling; no session token is written to browser storage by this studio.</small>
        </section>
      ) : (
        <>
          <aside className="ss-creator-account" aria-label="Creator account">
            <span aria-hidden="true">{creatorSession?.user.displayName.slice(0, 1).toUpperCase() || "S"}</span>
            <div>
              <small>Creating as</small>
              <strong>{creatorSession?.user.displayName || "Guest creator"}</strong>
            </div>
            <div className="ss-creator-account__plan">
              <small>{creatorSession ? (creatorSession.entitlement.plan === "free" ? "Free creator" : creatorSession.entitlement.plan) : "Preview access"}</small>
              <strong>
                {!creatorSession
                  ? "Creating without sign-in"
                  : creatorSession.publicListingQuota.remaining === null
                  ? "Public requests included"
                  : `${creatorSession.publicListingQuota.remaining} public ${creatorSession.publicListingQuota.remaining === 1 ? "request" : "requests"} left / 7 days`}
              </strong>
            </div>
            {creatorSession ? <button type="button" onClick={signOut}>Sign out</button> : <span aria-hidden="true" />}
          </aside>

      <form
        ref={formRef}
        className="ss-create-form ss-create-form--guided"
        onSubmit={submit}
        noValidate
        onChangeCapture={(event) => {
          const name = (event.target as unknown as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name;
          if (characterBible && !["apiKey", "generationConfirmed", "visibility", "spendCapEnabled", "spendCapUsd"].includes(name)) {
            clearCharacterReview();
          }
          if (!["apiKey", "generationConfirmed", "visibility", "spendCapEnabled", "spendCapUsd"].includes(name)) {
            setServerEstimate(null);
            setEstimateApproval(null);
            setEstimateStatus("idle");
          }
        }}
      >
        <nav className="ss-studio-progress" aria-label="Creation steps">
          <div className="ss-studio-progress__toolbar">
            <span><strong>Step {String(displayedStep).padStart(2, "0")}</strong> of {visibleStepIds.length}</span>
            <button type="button" className="ss-studio-guide-trigger" onClick={openStudioGuide}>
              <span aria-hidden="true">?</span><span>Studio guide</span>
            </button>
          </div>
          <ol>
            {visibleStepIds.map((itemStep, index) => {
              const [label, description] = CREATOR_STEPS[itemStep - 1];
              const available = itemStep <= furthestStep;
              return (
                <li key={label} className={itemStep === step ? "is-current" : itemStep < step ? "is-complete" : ""}>
                  <button
                    type="button"
                    disabled={!available}
                    aria-current={itemStep === step ? "step" : undefined}
                    onClick={() => available && moveToStep(itemStep)}
                  >
                    <span>{itemStep < step ? "✓" : String(index + 1).padStart(2, "0")}</span>
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="ss-studio-progress__meter" aria-hidden="true"><span style={{ width: `${((displayedStep - 1) / (visibleStepIds.length - 1)) * 100}%` }} /></div>
        </nav>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="1" hidden={step !== 1}>
          <StudioHeading
            number={displayedSectionNumber(1)}
            kicker="Choose a beginning"
            title="Where does this story come from?"
            description="Your choice sets the provenance trail, permission checks, and the questions that follow."
            help="Choose My manuscript for text you control, Public-domain library for a verified classic, or Build an original to develop a new story from its dramatic foundations."
          />

          <div className="ss-choice-row ss-source-lanes">
            <Choice checked={sourceLane === "upload"} name="sourceLane" value="upload" title="My manuscript" description="Upload a plain-text file or paste text you own or may legally transform." onChange={() => changeSourceLane("upload")} />
            <Choice checked={sourceLane === "gutenberg"} name="sourceLane" value="gutenberg" title="Public-domain library" description="Search a rights-aware catalog by title or author, or enter an eBook number." onChange={() => changeSourceLane("gutenberg")} />
            <Choice checked={sourceLane === "ai_original"} name="sourceLane" value="ai_original" title="Build an original" description="Shape the dramatic foundations while AI assists with drafting and illustration." onChange={() => changeSourceLane("ai_original")} />
          </div>

          <div className="ss-form-grid">
            <label>
              Creator credit
              <input name="authorDisplayName" required maxLength={100} defaultValue={creatorSession?.user.displayName || ""} placeholder="Name or pen name" />
              <span>This appears as “Created by” on the title page.</span>
            </label>
            <label>
              Scroll title <span>(you may change it later)</span>
              <input name="title" required={sourceLane === "ai_original"} maxLength={140} value={scrollTitle} onChange={(event) => setScrollTitle(event.currentTarget.value)} placeholder="The Lantern Beyond the Wood" />
            </label>
          </div>

          {sourceLane === "upload" ? (
            <div className="ss-source-workspace">
              <fieldset className="ss-theme-fieldset">
                <legend>Bring in the text</legend>
                <div className="ss-choice-row ss-choice-row--two">
                  <Choice checked={uploadInputMode === "file"} name="uploadInputMode" value="file" title="Upload .txt or .md" description="The file is read for this creation request and is never placed in browser storage." onChange={() => setUploadInputMode("file")} />
                  <Choice checked={uploadInputMode === "paste"} name="uploadInputMode" value="paste" title="Paste text" description="Best for a short story, chapter, or excerpt you can legally adapt." onChange={() => setUploadInputMode("paste")} />
                </div>
              </fieldset>
              {uploadInputMode === "file" ? (
                <label>
                  Manuscript file
                  <input
                    name="manuscript"
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    required
                    onChange={async (event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      setManuscriptFile(file);
                      setManuscriptText("");
                      setSourceCharacterCount(0);
                      if (!file) return;
                      if (file.size > MAX_MANUSCRIPT_BYTES || !MANUSCRIPT_TYPES.has(file.type)) {
                        event.currentTarget.value = "";
                        setManuscriptFile(null);
                        fail("Use one .txt or .md manuscript no larger than 8 MB.");
                        return;
                      }
                      const text = await file.text();
                      setManuscriptText(text);
                      setSourceCharacterCount(text.length);
                    }}
                  />
                  <span>{manuscriptFile ? `${manuscriptFile.name} · ${sourceCharacterCount.toLocaleString()} characters read locally` : "One UTF-8 text or Markdown file, up to 8 MB."}</span>
                </label>
              ) : (
                <label>
                  Source text
                  <textarea
                    className="ss-source-text"
                    name="sourceText"
                    rows={12}
                    minLength={80}
                    maxLength={MAX_SOURCE_CHARACTERS}
                    required
                    onChange={(event) => setSourceCharacterCount(event.currentTarget.value.length)}
                    placeholder="Paste the complete text you have the right to use…"
                  />
                  <span>{sourceCharacterCount.toLocaleString()} / {MAX_SOURCE_CHARACTERS.toLocaleString()} characters</span>
                </label>
              )}
              <div className="ss-form-grid">
                <label>Original title<input name="sourceTitle" required maxLength={180} value={sourceTitle} onChange={(event) => setSourceTitle(event.currentTarget.value)} /></label>
                <label>Original author<input name="originalAuthor" required maxLength={160} value={originalAuthor} onChange={(event) => setOriginalAuthor(event.currentTarget.value)} /></label>
              </div>
            </div>
          ) : null}

          {sourceLane === "gutenberg" ? (
            <div className="ss-source-workspace ss-gutenberg-picker">
              <div className="ss-gutenberg-search" role="search">
                <label>
                  Search the public-domain catalog
                  <span className="ss-input-with-action">
                    <input
                      value={gutenbergQuery}
                      onChange={(event) => setGutenbergQuery(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void searchGutenberg();
                        }
                      }}
                      placeholder="Title, author, or subject"
                      aria-describedby="ss-gutenberg-search-status"
                    />
                    <button type="button" onClick={() => void searchGutenberg()} disabled={gutenbergStatus === "searching"}>
                      {gutenbergStatus === "searching" ? "Searching…" : "Search"}
                    </button>
                  </span>
                </label>
                <p id="ss-gutenberg-search-status" className={gutenbergStatus === "error" ? "is-error" : ""} aria-live="polite">
                  {gutenbergMessage || "Search the live catalog, then choose the exact edition. You can still enter an eBook number directly."}
                </p>
              </div>
              {gutenbergBooks.length ? (
                <ul className="ss-gutenberg-results" aria-label="Public-domain catalog search results">
                  {gutenbergBooks.map((book) => (
                    <li key={book.id} className={gutenbergReference === String(book.id) ? "is-selected" : ""}>
                      <button type="button" onClick={() => chooseGutenbergBook(book)}>
                        <span aria-hidden="true">{gutenbergReference === String(book.id) ? "✓" : "G"}</span>
                        <span>
                          <strong>{book.title}</strong>
                          <small>{book.authors.join(", ") || "Author not listed"} · eBook #{book.id}</small>
                        </span>
                        <span>{gutenbergReference === String(book.id) ? "Selected" : "Choose"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="ss-form-grid">
                <label>
                  Selected eBook number or URL
                  <input name="gutenbergReference" required value={gutenbergReference} onChange={(event) => setGutenbergReference(event.currentTarget.value)} placeholder="1342 or https://www.gutenberg.org/ebooks/1342" />
                </label>
                <a href="https://www.gutenberg.org/ebooks/" target="_blank" rel="noreferrer">Browse the source library ↗</a>
                <label>Original title<input name="sourceTitle" maxLength={180} value={sourceTitle} onChange={(event) => setSourceTitle(event.currentTarget.value)} placeholder="Filled automatically from the selected record" /><span>We fill this from the catalog record.</span></label>
                <label>Original author<input name="originalAuthor" maxLength={160} value={originalAuthor} onChange={(event) => setOriginalAuthor(event.currentTarget.value)} placeholder="Filled automatically from the selected record" /><span>We fill this from the catalog record.</span></label>
              </div>
            </div>
          ) : null}

          {sourceLane === "ai_original" ? (
            <div className="ss-story-workshop">
              <div className="ss-story-workshop__intro">
                <span aria-hidden="true">✦</span>
                <div><strong>Think like a storyteller.</strong><p>There are no magic “good story” words. A strong story begins with desire, pressure, change, and an ending those choices earn.</p></div>
              </div>
              <div className="ss-form-grid">
                <label>Premise<textarea name="premise" rows={3} required minLength={12} maxLength={600} placeholder="What happens, to whom, and why is it worth telling?" /></label>
                <label>Setting &amp; atmosphere<textarea name="settingAndTone" rows={3} required minLength={12} maxLength={600} placeholder="Where are we, what feels unusual, and what emotional weather surrounds it?" /></label>
                <label>Main character<textarea name="protagonist" rows={3} required minLength={12} maxLength={700} placeholder="Who are they before the story changes them? Include strengths, flaws, and a visual signature." /></label>
                <label>Supporting characters<textarea name="supportingCharacters" rows={3} maxLength={900} placeholder="Who helps, challenges, mirrors, or complicates the protagonist—and why?" /></label>
                <label>Want<textarea name="characterDesire" rows={3} required minLength={12} maxLength={500} placeholder="What do they believe will make everything better at the beginning?" /></label>
                <label>Need<textarea name="characterNeed" rows={3} required minLength={12} maxLength={500} placeholder="What truth, skill, relationship, or change do they actually need? The want and need may conflict." /></label>
                <label>Central conflict<textarea name="centralConflict" rows={3} required minLength={12} maxLength={700} placeholder="Who or what pushes back, and why can neither side simply give way?" /></label>
                <label>Stakes<textarea name="stakes" rows={3} required minLength={12} maxLength={700} placeholder="What can be lost—outside and inside—and why does it matter now?" /></label>
                <label>Act I · the inciting turn<textarea name="incitingTurn" rows={3} required minLength={12} maxLength={700} placeholder="What breaks ordinary life and makes a choice unavoidable?" /></label>
                <label>Act II · pressure &amp; reversal<textarea name="midpointTurn" rows={3} required minLength={12} maxLength={700} placeholder="How do attempts make matters harder, and what midpoint discovery changes the plan?" /></label>
                <label>Act III · crisis &amp; climax<textarea name="climaxChoice" rows={3} required minLength={12} maxLength={700} placeholder="At the lowest point, what decisive choice proves how the character has—or has not—changed?" /></label>
                <label>Character arc<textarea name="characterArc" rows={3} required minLength={12} maxLength={700} placeholder="What must they learn, surrender, forgive, or become able to do?" /></label>
                <label>Theme or lesson<textarea name="themeLesson" rows={3} required minLength={12} maxLength={500} placeholder="What idea should emerge through choices and consequences—not a lecture?" /></label>
                <label>Planned ending<textarea name="plannedEnding" rows={3} required minLength={12} maxLength={700} placeholder="What resolves, what changes, and what feeling should remain?" /></label>
                <label>Promise to the reader<textarea name="readerPromise" rows={3} required minLength={12} maxLength={500} placeholder="Wonder, laughter, mystery, courage, comfort—what experience are you promising?" /></label>
              </div>
            </div>
          ) : null}

          <StepActions step={1} onBack={() => undefined} onNext={next} nextLabel={sourceLane === "gutenberg" ? "Shape the story" : "Confirm permission"} />
        </section>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="2" hidden={step !== 2 || sourceLane === "gutenberg"}>
          <StudioHeading number={displayedSectionNumber(2)} kicker="Permission before polish" title="Why may this story be used?" description="Beautiful presentation never changes the rights beneath a source." help="Record the clearest honest basis for use. Public-domain and licensed sources should include an authoritative edition or license link whenever possible." />
          <div className="ss-rights-gate" role="note">
            <span aria-hidden="true">✓</span>
            <p><strong>Tell us which simple statement is true.</strong> We save that choice with the scroll so readers can understand where it came from.</p>
          </div>
          <div className="ss-choice-row ss-choice-row--rights">
            <Choice checked={rightsBasis === "own"} name="rightsBasis" value="own" title="I own it" description="Original work or rights you control." disabled={sourceLane === "gutenberg"} onChange={() => setRightsBasis("own")} />
            <Choice checked={rightsBasis === "public_domain"} name="rightsBasis" value="public_domain" title="Public domain" description="A qualifying edition whose copyright term has expired." disabled={sourceLane === "ai_original"} onChange={() => setRightsBasis("public_domain")} />
            <Choice checked={rightsBasis === "licensed"} name="rightsBasis" value="licensed" title="Licensed" description="Explicit permission or an open license." disabled={sourceLane !== "upload"} onChange={() => setRightsBasis("licensed")} />
          </div>
          <p className="ss-form-help">{rightsHelp}</p>
          {rightsBasis !== "own" ? (
            <label>
              Permission note
              <textarea name="rightsStatement" rows={4} required minLength={10} maxLength={1200} placeholder="In plain language, name the public-domain edition, permission, or license." />
              <span>No legal wording is needed—just enough for another person to understand the source.</span>
            </label>
          ) : <p className="ss-form-help">That is enough. You do not need to write a legal explanation for work you own.</p>}
          {sourceLane !== "ai_original" ? (
            <label>
              Supporting source and rights URLs <span>(one HTTPS link per line)</span>
              <textarea name="sourceUrls" rows={3} required={sourceLane !== "gutenberg" && rightsBasis !== "own"} maxLength={20489} placeholder="https://example.org/canonical-edition\nhttps://example.org/license" />
              <span>{sourceLane === "gutenberg" ? "The canonical source-edition link is recorded automatically." : "These links appear in the final colophon."}</span>
            </label>
          ) : null}
          <label className="ss-confirmation">
            <input type="checkbox" name="rightsConfirmed" required />
            <span>I confirm that I have the right to submit, transform, illustrate, store, and share this material, and that my source and ownership statements are accurate.</span>
          </label>
          <StepActions step={2} onBack={() => moveToStep(1)} onNext={next} nextLabel="Shape the story" />
        </section>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="3" hidden={step !== 3}>
          <StudioHeading number={displayedSectionNumber(3)} kicker="The story’s shape" title={sourceLane === "ai_original" ? "Set the scope of the first draft." : "Choose what may change."} description={sourceLane === "ai_original" ? "Your workshop plan remains the source of truth while the studio builds and audits the chapter arc." : "Every material transformation is named on the title page so readers understand this edition."} help="Chapter count and length shape both pacing and cost. For adaptations, choose one primary treatment and use the guidance field for a few non-negotiable details." />

          {sourceLane !== "ai_original" && (sourceVersionStatus === "searching" || sourceVersionMessage || sourceVersions.length) ? (
            <section className={`ss-source-versions${sourceVersionsDismissed ? " is-dismissed" : ""}`} aria-labelledby="ss-source-versions-title">
              <div className="ss-source-versions__heading">
                <div><p className="ss-kicker">Already on the shelf</p><h3 id="ss-source-versions-title">See how other storytellers approached this source.</h3></div>
                <span>{sourceVersionStatus === "searching" ? "Checking…" : `${sourceVersions.length} approved public ${sourceVersions.length === 1 ? "version" : "versions"}`}</span>
              </div>
              {!sourceVersionsDismissed && sourceVersions.length ? (
                <div className="ss-source-version-grid">
                  {sourceVersions.map((version) => (
                    <article key={version.slug}>
                      <div className="ss-source-version__cover">
                        {version.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={version.coverUrl} alt="" loading="lazy" />
                        ) : <span aria-hidden="true">S</span>}
                      </div>
                      <div>
                        <p>{version.transformation}{version.targetLanguage ? ` · ${version.targetLanguage}` : ""}{version.targetAge ? ` · age ${version.targetAge}` : ""}</p>
                        <h4>{version.title}</h4>
                        <small>Created by {version.creatorName} · {version.qualityProfile} craft · {version.artLevel} art</small>
                        <small>{version.readingDepth} depth · {version.format} · {version.illustrationRichness}{version.targetAge ? ` · age ${version.targetAge}` : ""}{version.targetLanguage ? ` · ${version.targetLanguage}` : ""}</small>
                        <small>From <em>{version.sourceTitle}</em> by {version.originalAuthor}</small>
                        <a href={version.url} data-story-entry data-story-title={version.title}>Read this version <span aria-hidden="true">→</span></a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {sourceVersionMessage && sourceVersionStatus !== "searching" ? <p className="ss-source-versions__message">{sourceVersionMessage}</p> : null}
              {sourceVersions.length && !sourceVersionsDismissed ? <button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => setSourceVersionsDismissed(true)}>Create another interpretation anyway</button> : null}
              {sourceVersionsDismissed ? <p className="ss-source-versions__message"><strong>Wonderful.</strong> Similar source, different choices—your interpretation can still be entirely its own.</p> : null}
              <small>Only approved, publicly listed scrolls appear here. Existing versions are inspiration, never a barrier to creating another.</small>
            </section>
          ) : null}

          {sourceLane !== "ai_original" ? (
            <fieldset className="ss-theme-fieldset ss-transformation-fieldset">
              <legend>Text treatment</legend>
              <div className="ss-choice-row ss-rewrite-grid">
                {([
                  ["faithful", "Faithful edition", "Preserve the complete story, voice, plot, and ending."],
                  ["summary", "Story digest", "Retell the complete causal arc as a shorter, flowing narrative."],
                  ["translate", "Translate", "Retell faithfully in another language."],
                  ["modernize", "Modernize", "Make older language natural for a contemporary reader."],
                  ["reimagine", "Reimagine", "Change bounded characters, setting, or story conditions."],
                  ["alternate_ending", "New ending", "Preserve the road, then resolve it differently."],
                ] as const).map(([value, title, description]) => (
                  <Choice key={value} checked={rewriteChoice === value} name="rewriteChoice" value={value} title={title} description={description} onChange={() => setRewriteChoice(value)} />
                ))}
              </div>
            </fieldset>
          ) : null}

          {rewriteChoice === "summary" && sourceLane !== "ai_original" ? (
            <div className="ss-summary-level">
              <div><strong>How condensed?</strong><span>Every level keeps the central arc, motivations, turning points, consequences, and ending.</span></div>
              <select name="summaryLevel" value={summaryLevel} onChange={(event) => setSummaryLevel(event.currentTarget.value as SummaryLevel)}>
                <option value="brief">Brief · the essential story</option>
                <option value="balanced">Balanced · plot and character</option>
                <option value="detailed">Detailed · a fuller digest</option>
              </select>
            </div>
          ) : null}
          {rewriteChoice === "translate" ? <label>Target language<input name="targetLanguage" required maxLength={80} placeholder="Spanish, Japanese, Brazilian Portuguese…" /></label> : null}
          {rewriteChoice === "modernize" ? (
            <label>Modernization depth<select name="modernization" defaultValue="full"><option value="light">Light · explain and clarify</option><option value="full">Full · natural contemporary prose</option></select></label>
          ) : null}
          {rewriteChoice === "reimagine" ? (
            <div className="ss-form-grid">
              <label>New setting<input name="reimaginedSetting" required maxLength={300} placeholder="A floating city in a near-future ocean" /></label>
              <label>Character changes<input name="characterChanges" maxLength={500} placeholder="Roles, identities, relationships—keep changes bounded" /></label>
              <label className="ss-grid-span">Reimagining boundaries<textarea name="reimaginationNotes" rows={4} required minLength={20} maxLength={1200} placeholder="What should change, what must remain, and why will the original arc still matter?" /></label>
            </div>
          ) : null}
          {rewriteChoice === "alternate_ending" ? <label>Alternate ending<textarea name="alternateEnding" rows={5} required minLength={20} maxLength={1200} placeholder="Describe the new decisive choice, its consequences, and the emotional resolution…" /></label> : null}

          {sourceLane !== "ai_original" ? (
            <label>Adaptation guidance <span>(optional)</span><textarea name="adaptationBrief" rows={4} maxLength={1800} placeholder="Voice, pacing, details that must survive, cultural or historical context…" /></label>
          ) : null}

          <fieldset className="ss-theme-fieldset ss-scope-planner">
            <legend>Story length <HelpTip label="Story length">Automatic uses the source size, treatment, summary depth, format, and intended reader to choose a coherent first plan. Open the override only when you need exact production bounds.</HelpTip></legend>
            <div className="ss-choice-row ss-choice-row--two">
              <Choice checked={scopeMode === "automatic"} name="scopeMode" value="automatic" title="Automatic · recommended" description="Let the story treatment and reader settings choose chapter count and pacing." onChange={() => setScopeMode("automatic")} />
              <Choice checked={scopeMode === "custom"} name="scopeMode" value="custom" title="Exact override" description="Set hard chapter and length bounds for a specific production need." onChange={() => { setTargetChapters(automaticScope.chapters); setTargetWordsPerChapter(automaticScope.wordsPerChapter); setScopeMode("custom"); }} />
            </div>
            {scopeMode === "automatic" ? (
              <div className="ss-output-format ss-output-format--automatic" aria-live="polite">
                <span>Automatic plan</span>
                <strong>{isPictureBook ? `${plannedChapters} illustrated chapters` : `≈ ${(plannedChapters * plannedWordsPerChapter).toLocaleString()} words`}</strong>
                <small>{plannedChapters} chapter{plannedChapters === 1 ? "" : "s"}{isPictureBook ? " · images carry the story" : ` · about ${plannedWordsPerChapter.toLocaleString()} words each`}</small>
              </div>
            ) : (
              <div className="ss-form-grid ss-form-grid--three">
                <label>Target chapters<input name="targetChapters" type="number" min={1} max={24} value={targetChapters} onChange={(event) => { const chapters = Number(event.currentTarget.value) || 1; setTargetChapters(chapters); setIllustrationBudgetCount((count) => customQuality ? Math.max(count, 1 + chapters * 2) : 1 + chapters * craftProfile.imagesPerChapter); }} required /></label>
                <label>Words per chapter<input name="targetWordsPerChapter" type="number" min={100} max={2000} step={50} value={targetWordsPerChapter} disabled={isPictureBook} onChange={(event) => setTargetWordsPerChapter(Number(event.currentTarget.value) || 100)} required={!isPictureBook} /></label>
                <div className="ss-output-format"><span>Planned length</span><strong>{isPictureBook ? "Images only" : `≈ ${(targetChapters * targetWordsPerChapter).toLocaleString()} words`}</strong><small>{targetChapters} chapter{targetChapters === 1 ? "" : "s"}</small></div>
              </div>
            )}
          </fieldset>

          <fieldset className="ss-cleanup-fieldset">
            <legend>Opening-note cleanup</legend>
            <p>Only a short balanced note at the absolute start of a chapter may be removed. Matching marks later in the prose are preserved.</p>
            <div><label><input type="checkbox" name="cleanup-square" defaultChecked /> Remove leading […] notes</label><label><input type="checkbox" name="cleanup-angle" defaultChecked /> Remove leading &lt;…&gt; notes</label><label><input type="checkbox" name="cleanup-round" /> Remove leading (…) notes</label></div>
          </fieldset>
          <StepActions step={3} onBack={() => moveToStep(sourceLane === "gutenberg" ? 1 : 2)} onNext={next} nextLabel="Choose the reader" />
        </section>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="4" hidden={step !== 4}>
          <StudioHeading number={displayedSectionNumber(4)} kicker="Write toward someone" title="Who should be able to enter this world?" description="Age adaptation changes vocabulary, pacing, peril, emotional framing, themes, and how much the pictures carry—not the reader’s dignity." help="Original voice preserves the intended level. Age adaptation reshapes the whole reading experience; picture-book mode asks ordered images to carry the story without visible body text." />
          <fieldset className="ss-theme-fieldset ss-audience-fieldset">
            <legend>Target reader <HelpTip label="Target reader">Choose the reading experience, not a judgment of ability. Age adaptation also changes peril, emotional framing, theme, and the work illustrations must do.</HelpTip></legend>
            <div className="ss-choice-row">
              <Choice checked={audienceChoice === "original"} name="audienceChoice" value="original" title="Original voice" description="Preserve the source or workshop’s intended reading level." onChange={() => chooseAudience("original")} />
              <Choice checked={audienceChoice === "adapted"} name="audienceChoice" value="adapted" title="Adapt for an age" description="Reshape language and illustration density for one age." onChange={() => chooseAudience("adapted")} />
              <Choice checked={audienceChoice === "picture_book"} name="audienceChoice" value="picture_book" title="Picture-book mode" description="Let ordered illustrations carry the story without visible body prose." onChange={() => chooseAudience("picture_book")} />
            </div>
            {audienceChoice !== "original" ? (
              <div className="ss-age-control"><div><label htmlFor="ss-target-reader-age">Write for age</label><output htmlFor="ss-target-reader-age">{targetReaderAge}</output></div><input id="ss-target-reader-age" name="targetReaderAge" type="range" min={2} max={120} value={targetReaderAge} onChange={(event) => setTargetReaderAge(Number(event.currentTarget.value))} /><p>{readingGuidance(targetReaderAge)}</p></div>
            ) : null}
            {audienceChoice !== "original" && targetReaderAge <= 8 ? <div className="ss-gentle-reader-promise" role="note"><span aria-hidden="true">♡</span><p><strong>Gentle-reader promise.</strong> For young children, the adaptation brief requires age-safe peril, non-graphic conflict, reassuring emotional framing, and a clear path back to safety. It preserves cause, choice, and growth without simply swapping in easier words.</p></div> : null}
            {isPictureBook ? <div className="ss-picture-book-note" role="note"><span aria-hidden="true">✦</span><div><strong>An image-only reading experience</strong><p>Story prose becomes a private storyboard. The finished reading body contains ordered illustrations and concise accessible alt text, while title and provenance remain readable.</p></div></div> : null}
          </fieldset>

          <fieldset className="ss-theme-fieldset ss-craft-investment">
            <legend>Investment in craft <HelpTip label="Investment in craft">Choose a named preset for a balanced bundle. Fine-tune only when you need direct control over writing, revisions, image frequency, art fidelity, or delivery size.</HelpTip></legend>
            <div className="ss-craft-investment__heading">
              <div>
                <p className="ss-kicker">{customQuality ? "Custom workshop" : craftProfile.promise}</p>
                <h3>{customQuality ? "Custom" : craftProfile.name}</h3>
              </div>
              <output htmlFor="ss-craft-level" aria-live="polite">{formatMoney(costEstimate.minimum)}–{formatMoney(costEstimate.maximum)} <small>planning range</small></output>
            </div>
            <input
              id="ss-craft-level"
              className="ss-craft-slider"
              type="range"
              min={0}
              max={4}
              step={1}
              value={qualityLevel}
              aria-label="Investment in craft"
              aria-valuetext={`${customQuality ? "Custom based on " : ""}${craftProfile.name}: ${craftProfile.promise}`}
              onChange={(event) => chooseCraftLevel(Number(event.currentTarget.value) as CraftLevel)}
            />
            <div className="ss-craft-stops" aria-hidden="true">
              {CRAFT_PROFILES.map((profile) => <span key={profile.level} className={qualityLevel === profile.level && !customQuality ? "is-current" : ""}><strong>{profile.name}</strong><small>{profile.promise}</small></span>)}
            </div>
            <p className="ss-craft-investment__gain">{customQuality ? "You have tuned the workshop controls below; the estimate now reflects that custom mix." : craftProfile.gains}</p>
            <details className="ss-fine-tune">
              <summary><span>Fine-tune this scroll</span><small>Writing, revision, image frequency, art fidelity, and delivery quality</small></summary>
              <div className="ss-fine-tune__grid">
                <label>
                  <span><strong>Writing craft</strong><output>{writingTier === "literary" ? "Literary" : writingTier === "balanced" ? "Story-rich" : "Direct"}</output></span>
                  <input type="range" min={0} max={2} step={1} value={writingTier === "literary" ? 2 : writingTier === "balanced" ? 1 : 0} aria-label="Writing craft" aria-valuetext={writingTier === "literary" ? "Literary craft using GPT-5.6 Sol" : writingTier === "balanced" ? "Story-rich craft using GPT-5.6 Terra" : "Direct craft using GPT-5.6 Luna"} onChange={(event) => chooseWritingCraft(Number(event.currentTarget.value))} />
                  <small>Higher settings spend more reasoning on voice, nuance, causality, and long-range consistency. {writingTier === "literary" ? "GPT-5.6 Sol" : writingTier === "balanced" ? "GPT-5.6 Terra" : "GPT-5.6 Luna"}.</small>
                </label>
                <label>
                  <span><strong>Editorial refinement</strong><output>{refinementPasses} {refinementPasses === 1 ? "pass" : "passes"}</output></span>
                  <input type="range" min={0} max={3} step={1} value={refinementPasses} aria-label="Editorial refinement passes" aria-valuetext={`${refinementPasses} editorial refinement ${refinementPasses === 1 ? "pass" : "passes"}`} onChange={(event) => { setRefinementPasses(Number(event.currentTarget.value)); setCustomQuality(true); }} />
                  <small>Each pass re-reads the whole plan to strengthen arc, prose, continuity, and the earned ending. Each pass adds a text request.</small>
                </label>
                <label>
                  <span><strong>Illustration frequency</strong><output>{currentImagesPerChapter} / chapter</output></span>
                  <input type="range" min={2} max={8} step={1} value={currentImagesPerChapter} aria-label="Illustrations per chapter" aria-valuetext={`${currentImagesPerChapter} illustrations per chapter, plus one cover`} onChange={(event) => chooseIllustrationFrequency(Number(event.currentTarget.value))} />
                  <small>Two is the minimum: one chapter opener and one inline scene. Higher settings give busy chapters more visual beats and increase image charges.</small>
                </label>
                <label>
                  <span><strong>Art fidelity</strong><output>{imageTier === "premium" ? "Painterly" : imageTier === "standard" ? "Finished" : "Proof"}</output></span>
                  <input type="range" min={0} max={2} step={1} value={imageTier === "premium" ? 2 : imageTier === "standard" ? 1 : 0} aria-label="Art fidelity" aria-valuetext={imageTier === "premium" ? "Painterly high fidelity" : imageTier === "standard" ? "Finished medium fidelity" : "Proof low fidelity"} onChange={(event) => chooseArtFidelity(Number(event.currentTarget.value))} />
                  <small>Moves GPT Image 2 from low-cost proofs to cleaner detail, texture, lighting, and materials. Image cost rises substantially at high fidelity.</small>
                </label>
                <label>
                  <span><strong>Delivery quality</strong><output>{outputSize === "retina" ? "Archive" : outputSize === "standard" ? "Standard" : "Web"}</output></span>
                  <input type="range" min={0} max={2} step={1} value={outputSize === "retina" ? 2 : outputSize === "standard" ? 1 : 0} aria-label="Illustration delivery quality" aria-valuetext={`${outputSize === "retina" ? "archive" : outputSize} delivery quality`} onChange={(event) => chooseOutputSize(Number(event.currentTarget.value))} />
                  <small>Controls local WebP encoding and retained delivery quality after generation. It does not buy more model detail or increase the OpenAI estimate; Art fidelity does.</small>
                </label>
              </div>
              <p className="ss-fine-tune__warning"><strong>Cost guardrail:</strong> the range updates as you tune, but it is not a quote or cap. Review your prepaid balance and usage alerts before generation. You will approve a fresh server estimate on the final step.</p>
            </details>
          </fieldset>
          <StepActions step={4} onBack={() => moveToStep(3)} onNext={next} nextLabel="Direct the art" />
        </section>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="5" hidden={step !== 5}>
          <StudioHeading number={displayedSectionNumber(5)} kicker="A coherent visual world" title="Give the story one visual language." description={`Every plan includes a cover, a wide chapter opener, and at least one inline scene per chapter—${minimumTotalImages} visible images for this scroll.`} help="AI art begins with a low-cost continuity sheet you approve. Supplied art must include a labeled cover, chapter hero, and inline scene for every chapter." />

          <div className="ss-choice-row ss-choice-row--two">
            <Choice checked={illustrationMode === "ai"} name="illustrationMode" value="ai" title="Create illustrations" description="Generate a reviewed character guide, then a consistent cover and interior set." onChange={() => setIllustrationMode("ai")} />
            <Choice checked={illustrationMode === "upload"} name="illustrationMode" value="upload" title="Use my artwork" description="Upload a complete labeled cover, hero, and inline set you may publish." disabled={isPictureBook} onChange={() => setIllustrationMode("upload")} />
          </div>

          {illustrationMode === "ai" ? (
            <div className="ss-ai-illustration-plan">
              <section className="ss-art-recommendation" aria-labelledby="ss-art-recommendation-title">
                <div><p className="ss-kicker">Suggested for {audienceChoice === "original" ? "the original audience" : `age ${targetReaderAge}`}{isPictureBook ? " · picture book" : ""}</p><h3 id="ss-art-recommendation-title">A visual language that helps this reader in.</h3><p>{suggestedArt.rationale}</p></div>
                <div className="ss-art-style-chips" aria-label="Recommended art styles">
                  {suggestedArt.styles.map((style) => <button type="button" key={style} className={visualStyle === style ? "is-selected" : ""} aria-pressed={visualStyle === style} onClick={() => { setVisualStyle(style); setArtDirection(`${suggestedArt.rationale} Use ${style} with consistent character silhouettes and no imitation of any living artist.`); }}>{style}</button>)}
                </div>
              </section>
              <div className="ss-form-grid">
                <label>Illustration language<input name="visualStyle" value={visualStyle} onChange={(event) => setVisualStyle(event.currentTarget.value)} maxLength={160} placeholder="Describe a medium and visual language" /><span>Choose a suggestion or write your own. Describe materials and mood—never ask for a living artist’s style.</span></label>
                <label>Custom art direction<textarea name="artDirection" rows={4} value={artDirection} onChange={(event) => setArtDirection(event.currentTarget.value)} maxLength={1200} placeholder="Palette, medium, period, emotional atmosphere, clear silhouettes, composition preferences, and anything to avoid…" /></label>
                <label>Exact continuity cast <span>(optional)</span><textarea name="continuityCharacters" rows={4} value={continuityCharactersText} onChange={(event) => setContinuityCharactersText(event.currentTarget.value)} maxLength={807} placeholder={"Mira Vale\nTomas Reed\nThe Clockmaker"} /><span>One exact character name per line, up to 8. Leave blank and the studio will identify the protagonist and central recurring cast automatically.</span></label>
              </div>
              <div className="ss-selected-craft" role="note"><span aria-hidden="true">✦</span><div><strong>{customQuality ? "Custom craft plan" : `${craftProfile.name} craft plan`}</strong><p>{aiCounts.visible} visible images · {imageTier === "premium" ? "painterly" : imageTier === "standard" ? "finished" : "proof"} fidelity · {outputSize === "retina" ? "archive" : outputSize} delivery. Return to Reader to fine-tune craft and cost.</p></div></div>
              <div className="ss-form-grid">
                <label>Budget images<select name="illustrationBudgetMode" value={illustrationBudgetMode} disabled={isPictureBook} onChange={(event) => { const mode = event.currentTarget.value as IllustrationBudgetMode; setIllustrationBudgetMode(mode); setFlexibleAllocation(mode === "total"); setIllustrationBudgetCount(mode === "total" ? minimumTotalImages : 2); setCustomQuality(true); }}><option value="total">Across the whole story</option><option value="per_chapter">In every chapter</option></select><span>The required cover, heroes, and inline scenes are always included.</span></label>
                <label>{illustrationBudgetMode === "total" ? "Total visible images" : "Images per chapter (plus cover)"}<input name="illustrationBudgetCount" type="number" min={illustrationBudgetMode === "total" ? minimumTotalImages : 2} max={illustrationBudgetMode === "total" ? 160 : 10} value={effectiveBudgetCount} onChange={(event) => { setIllustrationBudgetCount(Number(event.currentTarget.value) || 1); setCustomQuality(true); }} required /></label>
              </div>
              {illustrationBudgetMode === "total" ? <label className="ss-confirmation ss-flex-allocation"><input type="checkbox" name="flexibleAllocation" checked={flexibleAllocation} disabled={isPictureBook} onChange={(event) => { setFlexibleAllocation(event.currentTarget.checked); setCustomQuality(true); }} /><span><strong>Let the story place extra images well.</strong> Every chapter keeps its hero and inline minimum; additional scenes go to visually busy chapters while the approved total stays fixed.</span></label> : null}
              {audienceChoice !== "original" ? <div className="ss-budget-recommendation" role="note"><div><span>Age-aware recommendation</span><strong>{recommendedImageCount} images across the story</strong><p>About {recommendedImagesPerChapter} images per chapter plus the cover for age {targetReaderAge}; you remain in control.</p></div><button type="button" onClick={() => { setIllustrationBudgetMode("total"); setIllustrationBudgetCount(recommendedImageCount); setFlexibleAllocation(true); setCustomQuality(true); }}>Use recommendation</button></div> : null}
              <div className="ss-generation-estimate"><div><span>Visible art</span><strong>{aiCounts.visible}</strong><small>1 cover · {aiCounts.heroes} heroes · at least {aiCounts.inline} inline</small></div><div><span>Image requests</span><strong>{aiCounts.imageRequests}</strong><small>{aiCounts.visible} story images + 1 low-quality continuity reference</small></div><p>Before those images are produced, the studio generates one low-cost character-and-style sheet for your explicit approval. That exact approved sheet—not an unseen replacement—is then supplied to every final illustration. Prompts require each named character to appear no more than once in a scene unless the story itself calls for duplication.</p></div>
            </div>
          ) : (
            <fieldset className="ss-theme-fieldset ss-uploaded-art-plan">
              <legend>Complete illustration set <HelpTip label="Complete illustration set">Filenames carry placement instructions: 000 is the cover; chCC-hero opens a chapter; pctPPP places an inline image at a percentage through that chapter.</HelpTip></legend>
              <p className="ss-form-help">Name the cover <code>000__cover__ALT.ext</code>. Use <code>NNN__chCC-hero__ALT.ext</code> for each chapter hero and <code>NNN__chCC-pctPPP-ALIGN__ALT.ext</code> for inline art. The studio verifies one cover, one hero, and at least one inline image in every chapter.</p>
              <div className="ss-form-grid"><label>Illustration files <span>({illustrationFiles.length}/{MAX_ILLUSTRATION_FILES})</span><input name="illustrationFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple required onChange={(event) => setIllustrationFiles(Array.from(event.currentTarget.files ?? []))} /></label><label>Artwork credit<input name="artCredit" required maxLength={100} placeholder="Artist or rights holder" /></label></div>
              <label className="ss-confirmation"><input type="checkbox" name="artRightsConfirmed" required /><span>I have the right to publish every uploaded image and understand that normalized derivatives will be stored with this scroll.</span></label>
            </fieldset>
          )}

          <fieldset className="ss-theme-fieldset ss-illuminated-picker">
            <legend>Illuminated initials <HelpTip label="Illuminated initials">The selected complete alphabet supplies the decorative opening mark for chapters. Preview art is protected; the production scroll uses only a properly licensed set.</HelpTip></legend>
            <input type="hidden" name="themeId" value="manuscript" />
            <div className="ss-illuminated-picker__layout">
              <div className="ss-illuminated-picker__sample" aria-hidden="true">
                {selectedIlluminatedSet?.previewUrl ? (
                  // The catalog exposes a protected preview derivative, never the production glyph source.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedIlluminatedSet.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span>{selectedIlluminatedSet?.sampleCharacter || "A"}</span>
                )}
              </div>
              <div>
                <label>
                  Find a letter family
                  <input value={illuminatedQuery} onChange={(event) => setIlluminatedQuery(event.currentTarget.value)} placeholder="Botanical, Celtic, winter, science…" />
                </label>
                <label>
                  Complete alphabet
                  <select name="illuminatedSetId" value={selectedIlluminatedId} onChange={(event) => setSelectedIlluminatedId(event.currentTarget.value)}>
                    {visibleIlluminatedSets.map((item) => (
                      <option key={item.id} value={item.id}>{item.family} · {item.displayName}</option>
                    ))}
                  </select>
                </label>
                <p>
                  <strong>{selectedIlluminatedSet?.displayName}</strong>
                  {selectedIlluminatedSet ? ` · ${selectedIlluminatedSet.description}` : ""}
                </p>
                <small>
                  {illuminatedStatus === "ready"
                    ? `${illuminatedSets.length} complete sets synced from Illuminated Letters. Protected preview derivatives are shown here; source artwork is not exposed.`
                    : illuminatedStatus === "loading"
                      ? "Opening the daily illuminated-letter catalog…"
                      : "The live catalog is temporarily unavailable, so four trusted families are available as a safe fallback."}
                </small>
              </div>
            </div>
          </fieldset>

          <fieldset className="ss-theme-fieldset ss-story-font-picker">
            <legend>Reading type <HelpTip label="Reading type">Choose for sustained reading, not just the title-page mood. Literata and Atkinson are strongest for long passages; the handwritten faces create a more intimate storybook voice.</HelpTip></legend>
            <div className="ss-choice-row">
              <Choice checked={storyFont === "homemade-apple"} name="fontFamilyChoice" value="homemade-apple" title="Homemade Apple" description="A warm, everyday handwritten line with graceful rhythm." onChange={() => setStoryFont("homemade-apple")} />
              <Choice checked={storyFont === "caveat-brush"} name="fontFamilyChoice" value="caveat-brush" title="Caveat Brush" description="Bolder brush lettering with an energetic, highly readable shape." onChange={() => setStoryFont("caveat-brush")} />
              <Choice checked={storyFont === "classic-serif"} name="fontFamilyChoice" value="classic-serif" title="Classic book serif" description="Familiar printed-book forms for readers who prefer less ornament." onChange={() => setStoryFont("classic-serif")} />
              <Choice checked={storyFont === "literata"} name="fontFamilyChoice" value="literata" title="Literata" description="A literary screen serif shaped for comfortable long-form reading." onChange={() => setStoryFont("literata")} />
              <Choice checked={storyFont === "atkinson-hyperlegible"} name="fontFamilyChoice" value="atkinson-hyperlegible" title="Atkinson Hyperlegible" description="Highly distinct letterforms designed to make sustained reading easier." onChange={() => setStoryFont("atkinson-hyperlegible")} />
              <Choice checked={storyFont === "nunito"} name="fontFamilyChoice" value="nunito" title="Nunito" description="A friendly rounded face that feels welcoming for younger readers." onChange={() => setStoryFont("nunito")} />
            </div>
            <p className={`ss-font-preview ss-font-preview--${storyFont}`}>Every reader deserves a beautiful road into the story.</p>
          </fieldset>
          <StepActions step={5} onBack={() => moveToStep(4)} onNext={() => void openReviewWithEstimate()} nextLabel="Review the plan" />
        </section>

        <section className="ss-create-panel ss-create-panel--guided" data-creator-step="6" hidden={step !== 6}>
          <StudioHeading number={displayedSectionNumber(6)} kicker="The title page remembers" title="Review, credit, and create." description="The finished scroll tells readers who made this edition, where it began, what changed, and which tools helped." help="Nothing expensive begins until you approve the current estimate. With AI art, the first request creates only the continuity guide; final production waits for your separate approval." />

          <div className="ss-form-grid">
            {sourceLane !== "ai_original" ? <><label>Source edition<input name="sourceEdition" maxLength={240} value={sourceEdition} readOnly={sourceLane === "gutenberg"} onChange={(event) => setSourceEdition(event.currentTarget.value)} placeholder="Publisher, year, edition, or archive description" />{sourceLane === "gutenberg" ? <span>Filled from the selected public-domain record.</span> : null}</label><label>Original language<input name="originalLanguage" maxLength={80} value={originalLanguage} readOnly={sourceLane === "gutenberg"} onChange={(event) => setOriginalLanguage(event.currentTarget.value)} placeholder="English, Spanish, Japanese…" />{sourceLane === "gutenberg" ? <span>Filled from the selected public-domain record.</span> : null}</label></> : null}
            <label className="ss-grid-span">Plain-language description of changes<textarea name="changeDescription" rows={4} maxLength={1200} placeholder={sourceLane === "ai_original" ? "Original story developed from my guided premise, characters, arc, theme, and planned ending." : transformationDescription(rewriteChoice, new FormData())} /></label>
          </div>

          <dl className="ss-creation-summary">
            <ReviewLine label="Source">{sourceLane === "ai_original" ? "Original story workshop" : sourceLane === "gutenberg" ? "Public-domain source edition" : manuscriptFile?.name || "Pasted manuscript"}</ReviewLine>
            <ReviewLine label="Treatment">{sourceLane === "ai_original" ? "Original layered draft" : rewriteChoice.replaceAll("_", " ")}</ReviewLine>
            <ReviewLine label="Story length">{scopeMode === "automatic" ? "Automatic" : "Exact override"} · {plannedChapters} chapters{isPictureBook ? " · image-led" : ` · ≈ ${(plannedChapters * plannedWordsPerChapter).toLocaleString()} words`}</ReviewLine>
            <ReviewLine label="Reader">{audienceChoice === "original" ? "Original reading level" : isPictureBook ? `Image-only picture book · age ${targetReaderAge}` : `Age-adapted prose · age ${targetReaderAge}`}</ReviewLine>
            <ReviewLine label="Craft">{customQuality ? "Custom" : craftProfile.name} · {writingTier === "literary" ? "GPT-5.6 Sol" : writingTier === "balanced" ? "GPT-5.6 Terra" : "GPT-5.6 Luna"} · {refinementPasses} revision {refinementPasses === 1 ? "pass" : "passes"}</ReviewLine>
            <ReviewLine label="Illustration">{illustrationMode === "ai" ? `${aiCounts.visible} images · ${imageTier} fidelity · ${outputSize === "retina" ? "archive" : outputSize} delivery` : `${illustrationFiles.length} creator-supplied images`}</ReviewLine>
            <ReviewLine label="Required art">1 cover · {plannedChapters} chapter heroes · ≥{plannedChapters} inline scenes</ReviewLine>
            {illustrationMode === "ai" ? <ReviewLine label="Continuity reference">1 low-quality sheet · explicit approval · reused for every final image</ReviewLine> : null}
            <ReviewLine label="Reading design">{storyFont.replaceAll("-", " ")} · {selectedIlluminatedSet?.displayName || "illuminated initials"}</ReviewLine>
          </dl>

          <fieldset className="ss-theme-fieldset"><legend>Visibility <HelpTip label="Visibility">Private requires a creator account. Unlisted stays off the public shelf but works for anyone with the complete link. Public requests enter safety and rights review.</HelpTip></legend><div className="ss-choice-row ss-choice-row--visibility"><Choice checked={visibility === "private"} name="visibility" value="private" title="Private · account only" description={creatorSession ? "Only your signed-in creator account may open it." : "Sign in to keep a scroll available only to your account."} disabled={!creatorSession} onChange={() => setVisibility("private")} /><Choice checked={visibility === "unlisted"} name="visibility" value="unlisted" title="Unlisted · secret link" description="Anyone with the complete link may read it; it stays off the public shelf." onChange={() => setVisibility("unlisted")} /><Choice checked={visibility === "public"} name="visibility" value="public" title="Public · reviewed shelf" description={creatorSession?.publicListingQuota.remaining === 0 ? "Your seven-day public allowance is currently used; private and unlisted creation remains open." : "Reviewed for safety and rights before joining the searchable community library."} disabled={creatorSession?.publicListingQuota.remaining === 0} onChange={() => setVisibility("public")} /></div><p className="ss-form-help">Free creators may request one public-library review in a rolling seven-day window; supporter plans include more. Private and unlisted scrolls remain unlimited, and every shared scroll still passes safety and rights checks.</p></fieldset>

          <div className="ss-cost-review" aria-label="Estimated OpenAI cost plan">
            <div className="ss-cost-review__heading"><div><p className="ss-kicker">Estimate before approval</p><h3>{estimateStatus === "loading" ? "Calculating this exact plan…" : estimateStatus === "error" ? "The estimate needs another try." : "A planning range for this scroll"}</h3></div><span>Catalog {displayedCatalogVersion}</span></div>
            <dl><ReviewLine label="Estimated range">{estimateStatus === "loading" ? "Calculating…" : `${formatMoney(displayedEstimate.minimum)}–${formatMoney(displayedEstimate.maximum)}`}</ReviewLine><ReviewLine label="Expected requests">{serverEstimate?.inputs?.estimatedTextRequests ?? estimatedTextRequests} text · {illustrationMode === "ai" ? `${aiCounts.visible} final + 1 low-cost reference` : "0 image"}</ReviewLine></dl>
            <p>{serverEstimate?.disclaimer || "This is not a quote or a spending cap. Actual input, output, reasoning, reference-image work, retries, sizes, and current OpenAI pricing can change the charge."} Check <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">current API pricing ↗</a>, your prepaid balance, and project alerts before continuing.</p>
            <div className="ss-spend-cap">
              <label className="ss-spend-cap__toggle">
                <input
                  type="checkbox"
                  name="spendCapEnabled"
                  checked={spendCapEnabled}
                  onChange={(event) => {
                    setSpendCapEnabled(event.currentTarget.checked);
                    setSpendCapIssue(null);
                  }}
                />
                <span><strong>Use a best-effort request cap</strong><small>Ask the studio to stop at preflight if the current conservative estimate is above your limit.</small></span>
              </label>
              <label className="ss-spend-cap__amount" htmlFor="ss-spend-cap-usd">
                <span>Cap in USD</span>
                <span className="ss-spend-cap__input"><b aria-hidden="true">$</b><input id="ss-spend-cap-usd" name="spendCapUsd" type="number" inputMode="decimal" min="0.01" max="10000" step="0.01" value={spendCapUsd} disabled={!spendCapEnabled} required={spendCapEnabled} onChange={(event) => { setSpendCapUsd(event.currentTarget.value); setSpendCapIssue(null); }} /></span>
              </label>
              <p><strong>Important:</strong> this is a best-effort preflight guardrail, not live billing metering. Provider pricing and actual billing can vary after work starts. Keep hard project or organization spend controls enabled in your OpenAI account.</p>
            </div>
            {spendCapIssue ? (
              <div className="ss-spend-cap-alert" role="alert">
                <strong>The plan is above your cap.</strong>
                <p>{spendCapIssueMessage(spendCapIssue)}</p>
                <div>
                  {spendCapIssue.actions.includes("increase_cap") ? <button type="button" className="ss-studio-button ss-studio-button--gold" onClick={() => { const required = spendCapIssue.requiredEstimatedMaxUsd ?? displayedEstimate.maximum; setSpendCapEnabled(true); setSpendCapUsd(recommendedSpendCap(required).toFixed(2)); setSpendCapIssue(null); setStatus("idle"); setMessage("Cap raised to include a planning cushion. Review it, then approve and submit again."); }}>Raise cap with cushion</button> : null}
                  {spendCapIssue.actions.includes("reduce_quality_or_art") ? <><button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => { setSpendCapIssue(null); setStatus("idle"); setMessage("Lower the craft or art-fidelity controls, then return for a fresh estimate."); moveToStep(4); }}>Reduce quality</button><button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => { setSpendCapIssue(null); setStatus("idle"); setMessage("Reduce the illustration count, then return for a fresh estimate."); moveToStep(5); }}>Use fewer images</button></> : null}
                  {spendCapIssue.actions.includes("finish_as_is") ? <span>Finish-as-is is available only when the server reports recoverable partial work; it is never offered for a preflight stop.</span> : null}
                </div>
              </div>
            ) : null}
            {estimateStatus === "error" ? <button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => void openReviewWithEstimate()}>Retry estimate</button> : null}
          </div>

          {illustrationMode === "ai" ? (
            <section className={`ss-character-review${characterApproval ? " is-approved" : ""}`} aria-labelledby="character-review-title">
              <div className="ss-character-review__heading"><span aria-hidden="true">{characterApproval ? "✓" : "✦"}</span><div><p className="ss-kicker">Required pause</p><h3 id="character-review-title">Approve the visual reference before production</h3><p>{characterApproval ? "Approved. This exact visual sheet will be supplied to every final illustration for continuity." : characterBible ? "Inspect the actual reference sheet, visual language, and every recurring character. If anything is wrong, change the earlier inputs and prepare it again." : "Your first API request prepares a low-cost visual reference sheet plus its written character guide. No cover or interior art is generated until you see and approve it."}</p></div></div>
              {characterBible ? <>
                {characterBible.reference ? (
                  <figure className="ss-character-reference">
                    {/* The owner-scoped endpoint serves a private no-store derivative; it is never a public story asset. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={characterBible.reference.url} alt={characterBible.reference.altText} width={characterBible.reference.width} height={characterBible.reference.height} referrerPolicy="no-referrer" />
                    <figcaption>
                      <strong>{characterApproval ? "Approved continuity reference" : "Reference awaiting your approval"}</strong>
                      <span>{characterBible.reference.model} · {characterBible.reference.quality} quality · {formatMoney(characterBible.reference.estimatedOutputUsd)} output estimate · catalog {characterBible.reference.priceCatalogVersion}</span>
                    </figcaption>
                  </figure>
                ) : null}
                <blockquote>{characterBible.visualBible}</blockquote>
                <div className="ss-character-sheet">{characterBible.characters.length ? characterBible.characters.map((character) => <article key={character.name}><span aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</span><div><h4>{character.name}</h4><p>{character.description}</p></div></article>) : <p>No recurring named character needs a fixed appearance.</p>}</div>
                {!characterApproval ? <button type="button" className="ss-studio-button ss-studio-button--gold" onClick={approveCharacterBible} disabled={status === "approving"}>{status === "approving" ? "Recording approval…" : "Approve this exact visual reference"}</button> : null}
              </> : null}
              {legacyContinuityFallback ? <div className="ss-character-review__fallback"><p>The installed server can still create a continuity reference inside the final request, but cannot pause to show it first.</p>{!characterApproval ? <button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => { setCharacterApproval({ id: "legacy-inline", token: "" }); setMessage("Inline continuity fallback accepted. Re-enter your API key to begin final generation."); }}>Accept inline continuity for this draft</button> : null}</div> : null}
            </section>
          ) : null}

          <ApiKeyGuide />

          <div className="ss-key-panel"><div><p className="ss-kicker">Your generation, your key</p><h3>Paste your OpenAI API key</h3><p>{illustrationMode === "ai" && !characterApproval ? "This first request creates only the low-cost visual reference you will review. The field is cleared immediately; after approval, you re-enter the key for final production." : "Used only for this creation request. It is cleared before work starts and never saved in browser storage or the story record."}</p></div><label><span className="sr-only">OpenAI API key</span><input type="password" name="apiKey" required autoComplete="off" spellCheck={false} placeholder="sk-proj-… or sk-…" data-1p-ignore aria-describedby="ss-api-key-paste-help" /><small id="ss-api-key-paste-help">Paste the complete secret key. Nothing is charged merely by entering it.</small></label></div>

          <label className="ss-confirmation ss-cost-confirmation"><input type="checkbox" name="generationConfirmed" required disabled={estimateStatus !== "idle" || !estimateApproval} /><span>I reviewed the {formatMoney(displayedEstimate.minimum)}–{formatMoney(displayedEstimate.maximum)} planning estimate and authorize up to {serverEstimate?.inputs?.estimatedTextRequests ?? estimatedTextRequests} structured-text requests, {illustrationMode === "ai" ? `${aiCounts.visible} ${imageTier}-quality final image requests plus one low-quality reference-sheet request` : "safety checks on my uploaded artwork"}, and safety checks on my OpenAI account. {spendCapEnabled && parseSpendCap(spendCapUsd) !== null ? `I set a ${formatMoney(parseSpendCap(spendCapUsd)!)} best-effort preflight cap.` : "I chose not to set the optional studio cap."} I understand this is an estimate rather than live billing metering, actual provider charges and pricing may differ, and only provider account spend controls can enforce a hard billing limit.</span></label>

          <div className="ss-create-submit"><div><p>Private and unlisted work is still safety checked. Public requests also enter moderation and human review; challenging themes are not rejected merely for being difficult.</p></div><button type="submit" disabled={["preparing", "approving", "submitting"].includes(status)}>{status === "preparing" ? "Preparing the guide…" : status === "submitting" ? "Creating the scroll…" : illustrationMode === "ai" && !characterApproval ? "Prepare character guide" : "Create my scroll"}</button></div>

          {status !== "idle" || message ? <div className={`ss-create-result ss-create-result--${status === "error" ? "error" : status}`} role={status === "error" ? "alert" : "status"}><span aria-hidden="true">{status === "success" ? "✦" : status === "error" ? "!" : "S"}</span><div><h3>{status === "success" ? "Your scroll is ready" : status === "error" ? "One thing needs attention" : characterBible && !characterApproval ? "Guide ready for review" : "The studio is working"}</h3><p>{message}</p>{created ? <a href={created.url}>Open {created.title} →</a> : null}</div></div> : null}

          <div className="ss-studio-actions"><button type="button" className="ss-studio-button ss-studio-button--quiet" onClick={() => moveToStep(5)}>Back</button></div>
        </section>
      </form>
        </>
      )}
      <PlatformFooter />
    </main>
  );
}

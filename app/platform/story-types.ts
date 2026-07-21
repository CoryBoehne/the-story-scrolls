export type StoryAsset = {
  id: string;
  type: "image" | "cover" | "illustration" | string;
  path: string;
  alt: string;
  caption?: string | null;
  creator?: string | null;
  sourceUrl?: string | null;
  sourceSha256?: string | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  bytes?: number | null;
  sourceEbookId?: number | null;
  sourceProvider?: string | null;
  publicDomain?: boolean;
  license?: string | null;
};

export type StoryRun = {
  text: string;
  emphasis?: boolean;
  strong?: boolean;
  href?: string;
};

export type StoryParagraphBlock = {
  type: "paragraph";
  text: string;
  runs?: StoryRun[];
};

export type StoryVerseBlock = {
  type: "verse";
  lines: string[];
  shape?: string | null;
  preserveIndent?: boolean;
};

export type StoryImageBlock = {
  type: "image";
  assetId: string;
  placement?: "inline" | "plate" | "chapter-hero";
  align?: "left" | "right" | "center" | "plate" | "hero";
};

export type StoryOrnamentBlock = {
  type: "ornament";
  mark?: string;
};

export type StoryBlock =
  | StoryParagraphBlock
  | StoryVerseBlock
  | StoryImageBlock
  | StoryOrnamentBlock;

export type StoryChapter = {
  id: string;
  number?: string | number | null;
  label?: string | null;
  title: string;
  firstLetter?: string | null;
  blocks: StoryBlock[];
};

export type StorySource = {
  name?: string;
  url?: string;
  canonicalUrl?: string;
  textCatalogUrl?: string;
  textUrl?: string;
  edition?: string;
  sourceTitle?: string | null;
  originalAuthor?: string | null;
  originalLanguage?: string | null;
  changeDescription?: string | null;
  gutenbergId?: number | null;
  retrievedAt?: string;
  [key: string]: unknown;
};

export type StoryRights = {
  status?: string;
  license?: string;
  notice?: string;
  sourceUrl?: string;
  [key: string]: unknown;
};

export type StoryTransformation = {
  mode: "faithful" | "summary";
  summaryLevel?: "brief" | "balanced" | "detailed" | null;
  targetLanguage?: string | null;
  modernization?: "none" | "light" | "full";
  reimagination?: {
    enabled: boolean;
    setting?: string;
    characterChanges?: string;
    plotChanges?: string;
    alternateEnding?: string;
  };
};

export type StoryAudience = {
  targetAge?: number | null;
  format: "prose" | "picture_book";
};

export type StoryAdaptation = {
  transformation: StoryTransformation;
  audience: StoryAudience;
  textModel?: string | null;
  qualityLevel?: number | null;
  qualityProfile?: string | null;
  writingTier?: string | null;
  imageTier?: string | null;
  refinementPasses?: number | null;
  outputSize?: string | null;
  textRequestCount?: number | null;
  sourceCharacterCount?: number | null;
  continuityReferenceApproved?: boolean;
  continuityReferenceTier?: string | null;
  continuityReferenceQuality?: string | null;
};

export type StoryGenerationPresentation = {
  fontFamily?: "homemade-apple" | "caveat-brush" | "classic-serif" | string | null;
  illuminatedSetId?: string | null;
  illuminatedSetName?: string | null;
  illuminatedSetFamily?: string | null;
  illuminatedSetVersion?: number | string | null;
  illuminatedCatalogVersion?: string | null;
  illuminatedGlyphs?: Record<string, string> | null;
  illuminatedGlyphsSha256?: string | null;
  illuminatedDerivativePolicy?: string | null;
  visualStyle?: string | null;
  recommendedVisualStyle?: string | null;
  visualStyleSource?: string | null;
  [key: string]: unknown;
};

export type StoryDocument = {
  schemaVersion?: number | string;
  slug: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  illustrator?: string | null;
  language?: string;
  kind?: string;
  intro?: {
    kind?: string;
    frames?: string[];
    credit?: string | null;
  } | null;
  theme?: {
    id?: string;
    /** @deprecated Legacy full-alphabet path. New scrolls use illuminatedGlyphs. */
    illuminatedSet?: string;
    /** @deprecated Legacy public manifest path. */
    illuminatedManifest?: string;
    illuminatedGlyphs?: Record<string, string>;
    illuminatedSetId?: string;
    illuminatedSetName?: string;
    illuminatedSetVersion?: number | string;
    illuminatedCatalogVersion?: string;
    illuminatedGlyphsSha256?: string;
    illuminatedAttribution?: string;
    illuminatedTermsUrl?: string;
    illuminatedDerivativePolicy?: string;
    accent?: string;
  } | null;
  source?: StorySource | null;
  rights?: StoryRights | null;
  assets: StoryAsset[];
  chapters: StoryChapter[];
  coverAssetId?: string | null;
  contentWarnings?: string[];
  adaptation?: StoryAdaptation | null;
  generation?: StoryGenerationPresentation | null;
  build?: {
    deterministic?: boolean;
    assetEncoding?: string;
    generatedBy?: string;
    [key: string]: unknown;
  } | null;
  visibility?: "private" | "unlisted" | "public" | string;
  createdAt?: string;
  creatorName?: string | null;
};

export type LibraryStory = {
  slug: string;
  title: string;
  author?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  href?: string;
  chapterCount?: number | null;
  visibility?: string | null;
  kind?: string | null;
  createdAt?: string | null;
  contentWarnings?: string[];
  adaptation?: StoryAdaptation | null;
};

export function unwrapStoryPayload(value: unknown): StoryDocument | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const candidate =
    record.story && typeof record.story === "object"
      ? (record.story as Record<string, unknown>)
      : record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : record;

  if (
    typeof candidate.slug !== "string" ||
    typeof candidate.title !== "string" ||
    !Array.isArray(candidate.chapters)
  ) {
    return null;
  }

  return {
    ...(candidate as unknown as StoryDocument),
    assets: Array.isArray(candidate.assets)
      ? (candidate.assets as StoryAsset[])
      : [],
    chapters: candidate.chapters as StoryChapter[],
    adaptation: parseStoryAdaptation(candidate.adaptation),
  };
}

export function unwrapLibraryPayload(value: unknown): LibraryStory[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(record.community)
      ? record.community
    : Array.isArray(record.stories)
      ? record.stories
      : Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.data)
          ? record.data
          : [];

  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const story = item as Record<string, unknown>;
    if (typeof story.slug !== "string" || typeof story.title !== "string") {
      return [];
    }

    return [
      {
        slug: story.slug,
        title: story.title,
        author:
          optionalString(story.author) ?? optionalString(story.authorName),
        description:
          optionalString(story.description) ??
          optionalString(story.subtitle) ??
          optionalString(story.synopsis),
        coverUrl:
          optionalString(story.coverUrl) ?? optionalString(story.cover_url),
        href: optionalString(story.href) ?? undefined,
        chapterCount:
          typeof story.chapterCount === "number"
            ? story.chapterCount
            : typeof story.chapter_count === "number"
              ? story.chapter_count
              : null,
        visibility: optionalString(story.visibility),
        kind: optionalString(story.kind),
        createdAt:
          optionalString(story.createdAt) ?? optionalString(story.created_at),
        contentWarnings: Array.isArray(story.contentWarnings)
          ? story.contentWarnings.filter(
              (warning): warning is string => typeof warning === "string" && Boolean(warning.trim()),
            )
          : [],
        adaptation: parseStoryAdaptation(story.adaptation),
      },
    ];
  });
}

export function parseStoryAdaptation(value: unknown): StoryAdaptation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const transformationRecord = record.transformation && typeof record.transformation === "object"
    ? record.transformation as Record<string, unknown>
    : record;
  const audienceRecord = record.audience && typeof record.audience === "object"
    ? record.audience as Record<string, unknown>
    : record;
  const mode = transformationRecord.mode;
  const format = audienceRecord.format;
  if ((mode !== "faithful" && mode !== "summary") || (format !== "prose" && format !== "picture_book")) {
    return null;
  }
  const summaryLevel = transformationRecord.summaryLevel;
  const targetAge = audienceRecord.targetAge;
  const reimaginationRecord = transformationRecord.reimagination
    && typeof transformationRecord.reimagination === "object"
    && !Array.isArray(transformationRecord.reimagination)
      ? transformationRecord.reimagination as Record<string, unknown>
      : {};
  const modernization = transformationRecord.modernization;
  return {
    transformation: {
      mode,
      summaryLevel:
        summaryLevel === "brief" || summaryLevel === "balanced" || summaryLevel === "detailed"
          ? summaryLevel
          : null,
      targetLanguage: optionalString(transformationRecord.targetLanguage),
      modernization:
        modernization === "light" || modernization === "full" ? modernization : "none",
      reimagination: {
        enabled: reimaginationRecord.enabled === true,
        setting: optionalString(reimaginationRecord.setting) ?? undefined,
        characterChanges: optionalString(reimaginationRecord.characterChanges) ?? undefined,
        plotChanges: optionalString(reimaginationRecord.plotChanges) ?? undefined,
        alternateEnding: optionalString(reimaginationRecord.alternateEnding) ?? undefined,
      },
    },
    audience: {
      format,
      targetAge: Number.isInteger(targetAge) && Number(targetAge) >= 2 && Number(targetAge) <= 120
        ? Number(targetAge)
        : null,
    },
    textModel: optionalString(record.textModel),
    qualityLevel:
      Number.isInteger(record.qualityLevel) && Number(record.qualityLevel) >= 0
        ? Number(record.qualityLevel)
        : null,
    qualityProfile: optionalString(record.qualityProfile),
    writingTier: optionalString(record.writingTier),
    imageTier: optionalString(record.imageTier),
    refinementPasses:
      Number.isInteger(record.refinementPasses) && Number(record.refinementPasses) >= 0
        ? Number(record.refinementPasses)
        : null,
    outputSize: optionalString(record.outputSize),
    textRequestCount:
      Number.isInteger(record.textRequestCount) && Number(record.textRequestCount) > 0
        ? Number(record.textRequestCount)
        : null,
    sourceCharacterCount:
      Number.isInteger(record.sourceCharacterCount) && Number(record.sourceCharacterCount) >= 0
        ? Number(record.sourceCharacterCount)
        : null,
    continuityReferenceApproved: record.continuityReferenceApproved === true,
    continuityReferenceTier: optionalString(record.continuityReferenceTier),
    continuityReferenceQuality: optionalString(record.continuityReferenceQuality),
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

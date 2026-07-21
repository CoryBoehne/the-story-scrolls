import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCatalog } from "../scripts/sync-illuminated-catalog.mjs";

const DEFAULT_CACHE_DIRECTORY = fileURLToPath(
  new URL("../../../_data/thestoryscrolls/illuminated-catalog/current/", import.meta.url),
);
const PREVIEW_PATH_PATTERN = /^previews\/[a-z0-9][a-z0-9-]*-[a-f0-9]{16}\.(?:png|webp)$/;
const SET_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixedTimeEqual(left, right) {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function publicSet(set) {
  return Object.freeze({
    id: set.id,
    slug: set.slug,
    displayName: set.displayName,
    family: set.family,
    description: set.description,
    sortOrder: set.sortOrder,
    glyphCount: set.glyphCount,
    characterSet: set.characterSet,
    sampleCharacter: set.sampleCharacter,
    attribution: set.source.attribution,
    catalogPage: set.source.catalogUrl,
    licensing: Object.freeze({
      status: set.licensing.status,
      attributionRequired: Boolean(set.licensing.attributionRequired),
      termsUrl: set.licensing.termsUrl,
      note: set.licensing.note,
    }),
    previewUrl: `/api/v2/illuminated-sets/${encodeURIComponent(set.slug)}/preview`,
  });
}

function assertPublicSetMetadata(set) {
  if (
    !SET_SLUG_PATTERN.test(set.slug)
    || typeof set.displayName !== "string"
    || !set.displayName.trim()
    || typeof set.family !== "string"
    || !set.family.trim()
    || typeof set.description !== "string"
    || !set.description.trim()
    || typeof set.sampleCharacter !== "string"
    || !set.characterSet.includes(set.sampleCharacter)
    || set.source?.attribution !== "Illuminated Letters"
    || !String(set.source?.catalogUrl || "").startsWith("https://illuminatedletters.corydev.com/")
    || set.licensing?.status !== "terms-not-published-in-catalog"
  ) {
    throw new Error(`Illuminated catalog set ${set?.id || "unknown"} has unsafe public metadata.`);
  }
}

async function readBounded(filePath, maxBytes, label) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) {
    throw new Error(`${label} is missing or outside its byte limit.`);
  }
  return readFile(filePath);
}

export async function loadIlluminatedCatalog(cacheDirectory = DEFAULT_CACHE_DIRECTORY) {
  const catalogPath = path.join(cacheDirectory, "catalog.json");
  const indexPath = path.join(cacheDirectory, "cache-index.json");
  const [catalogBytes, indexBytes] = await Promise.all([
    readBounded(catalogPath, MAX_CATALOG_BYTES, "Illuminated catalog"),
    readBounded(indexPath, MAX_CATALOG_BYTES, "Illuminated cache index"),
  ]);
  const catalog = validateCatalog(JSON.parse(catalogBytes.toString("utf8")));
  const index = JSON.parse(indexBytes.toString("utf8"));
  if (
    index?.schemaVersion !== 1
    || index.catalogFile !== "catalog.json"
    || !fixedTimeEqual(index.catalogSha256, sha256(catalogBytes))
    || typeof index.cachedAt !== "string"
    || Number.isNaN(Date.parse(index.cachedAt))
    || !index.previews
    || typeof index.previews !== "object"
  ) {
    throw new Error("Illuminated cache index does not match the catalog.");
  }

  const previewBySlug = new Map();
  const publicSets = catalog.sets.map((set) => {
    assertPublicSetMetadata(set);
    const relativePreviewPath = index.previews[set.id];
    if (typeof relativePreviewPath !== "string" || !PREVIEW_PATH_PATTERN.test(relativePreviewPath)) {
      throw new Error(`${set.id} is missing a controlled preview derivative.`);
    }
    previewBySlug.set(set.slug, Object.freeze({
      relativePath: relativePreviewPath,
      sha256: set.derivatives.cardPreview.sha256,
      bytes: set.derivatives.cardPreview.bytes,
    }));
    return publicSet(set);
  });
  if (previewBySlug.size !== catalog.sets.length) {
    throw new Error("Illuminated catalog contains duplicate public slugs.");
  }

  return Object.freeze({
    cacheDirectory,
    cachedAt: index.cachedAt,
    catalogSha256: index.catalogSha256,
    sets: Object.freeze(publicSets),
    previewBySlug,
  });
}

export function publicIlluminatedCatalog(loaded) {
  return {
    schemaVersion: 1,
    cachedAt: loaded.cachedAt,
    count: loaded.sets.length,
    glyphCount: loaded.sets.reduce((total, set) => total + set.glyphCount, 0),
    source: {
      name: "Illuminated Letters",
      catalog: "https://illuminatedletters.corydev.com/",
      partner: "https://illuminatedfonts.com/",
    },
    previewPolicy: {
      availability: "controlled-watermarked-preview-derivatives-only",
      originalsPublished: false,
      archivesPublished: false,
      browserCopyProtection: false,
      notice:
        "Browser-visible previews cannot be made uncopyable. Originals and glyph source files are never served by this API.",
      licensing:
        "Usage terms are not published in this catalog. Production use requires a separate rights record.",
    },
    sets: loaded.sets,
  };
}

export async function readIlluminatedPreview(loaded, slug) {
  if (!SET_SLUG_PATTERN.test(slug)) return null;
  const descriptor = loaded.previewBySlug.get(slug);
  if (!descriptor) return null;
  const previewRoot = await realpath(path.join(loaded.cacheDirectory, "previews"));
  const requestedPath = await realpath(path.join(loaded.cacheDirectory, descriptor.relativePath));
  if (!requestedPath.startsWith(`${previewRoot}${path.sep}`)) {
    throw new Error("Illuminated preview escaped the controlled cache directory.");
  }
  const bytes = await readBounded(requestedPath, MAX_PREVIEW_BYTES, "Illuminated preview");
  if (bytes.length !== descriptor.bytes || !fixedTimeEqual(sha256(bytes), descriptor.sha256)) {
    throw new Error("Illuminated preview failed its integrity check.");
  }
  return {
    bytes,
    contentType: requestedPath.endsWith(".png") ? "image/png" : "image/webp",
  };
}

function writeJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(bytes);
}

/**
 * Create the two API-v2 routes. Authentication remains on by default; the
 * caller must explicitly disable it while the platform's launch gate is off.
 * The caller still supplies the session decision so this module never invents
 * an authentication boundary of its own.
 *
 * handle() returns false when the URL is not one of its routes, allowing the
 * platform server to continue routing. `isAuthenticated` receives the request
 * and must return a boolean (or a Promise resolving to one).
 */
export function createIlluminatedCatalogHandler({
  cacheDirectory = DEFAULT_CACHE_DIRECTORY,
  authenticationRequired = true,
  isAuthenticated,
  catalogCacheTtlMs = 5 * 60 * 1000,
} = {}) {
  if (typeof authenticationRequired !== "boolean") {
    throw new TypeError("Illuminated catalog authenticationRequired must be a boolean.");
  }
  if (typeof isAuthenticated !== "function") {
    throw new TypeError("Illuminated catalog delivery requires an authentication callback.");
  }
  if (!Number.isFinite(catalogCacheTtlMs) || catalogCacheTtlMs < 0) {
    throw new TypeError("Illuminated catalog cache TTL must be a non-negative number.");
  }
  let loadedPromise;
  let loadedExpiresAt = 0;
  const getLoaded = () => {
    const now = Date.now();
    if (!loadedPromise || now >= loadedExpiresAt) {
      loadedExpiresAt = now + catalogCacheTtlMs;
      loadedPromise = loadIlluminatedCatalog(cacheDirectory).catch((error) => {
        loadedPromise = undefined;
        loadedExpiresAt = 0;
        throw error;
      });
    }
    return loadedPromise;
  };

  return async function handleIlluminatedCatalog(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url || "/", "http://localhost").pathname;
    const previewMatch = pathname.match(/^\/api\/v2\/illuminated-sets\/([a-z0-9][a-z0-9-]{0,159})\/preview$/);
    const isCatalog = pathname === "/api/v2/illuminated-sets";
    if (!isCatalog && !previewMatch) return false;
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (authenticationRequired && !(await isAuthenticated(req))) {
      writeJson(res, 401, { error: "authentication_required" });
      return true;
    }
    try {
      const loaded = await getLoaded();
      if (isCatalog) {
        writeJson(res, 200, publicIlluminatedCatalog(loaded));
        return true;
      }
      const preview = await readIlluminatedPreview(loaded, previewMatch[1]);
      if (!preview) {
        writeJson(res, 404, { error: "preview_not_found" });
        return true;
      }
      const extension = preview.contentType === "image/png" ? "png" : "webp";
      res.writeHead(200, {
        "Content-Type": preview.contentType,
        "Content-Length": preview.bytes.length,
        "Cache-Control": "private, max-age=3600, must-revalidate",
        "Content-Disposition": `inline; filename="illuminated-preview-${previewMatch[1]}.${extension}"`,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      });
      res.end(preview.bytes);
      return true;
    } catch (error) {
      console.error("Illuminated catalog delivery failed:", error?.message || error);
      writeJson(res, 503, { error: "illuminated_catalog_unavailable" });
      return true;
    }
  };
}

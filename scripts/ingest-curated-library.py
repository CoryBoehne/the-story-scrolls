#!/usr/bin/env python3
"""Build safe, deterministic The Story Scrolls ASTs from the curated registry.

The registry pins one documented public-domain edition per story. Source HTML
and original image files live only in ``.cache``; the public tree receives a
sanitized JSON AST and, after the companion optimizer runs, compact WebP art.
No source-library wrapper, executable markup, or raw source HTML is emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup, NavigableString, Tag
from source_mirrors import source_download_candidates


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = PROJECT_ROOT / "config" / "curated-books.json"
PUBLIC_ROOT = PROJECT_ROOT / "public" / "stories"
CACHE_ROOT = PROJECT_ROOT / ".cache" / "curated-library"
USER_AGENT = "The Story Scrolls curated-edition builder/2.0 (https://thestoryscrolls.com/)"

BLOCK_KEYS = {
    "type",
    "text",
    "runs",
    "lines",
    "preserveIndent",
    "shape",
    "assetId",
    "placement",
    "align",
    "mark",
}

EXCLUDED_CLASSES = {
    "books",
    "contents",
    "copyright",
    "footnote",
    "footnotes",
    "pg-boilerplate",
    "pgheader",
    "pgfooter",
    "toc",
    "tn",
    "tnote",
    "transnote",
    "transcribers-note",
}

PAGE_FURNITURE = re.compile(
    r"(?:\[\s*(?:Pg\.?|Page)\s*\d+\s*\]|\{\s*\d+\s*\})",
    re.IGNORECASE,
)


@dataclass
class ImageCandidate:
    key: str
    source_url: str
    credit_url: str
    source_ebook_id: int | None
    chapter_index: int | None
    alt: str
    caption: str
    creator: str
    order: int
    license_label: str | None = None


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def download(url: str, destination: Path, *, max_bytes: int = 30 * 1024 * 1024) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    attempted: list[str] = []
    for candidate in source_download_candidates(url):
        attempted.append(candidate)
        temporary.unlink(missing_ok=True)
        result = subprocess.run(
            [
                "curl",
                "-fsSL",
                "--retry",
                "5",
                "--retry-all-errors",
                "--retry-delay",
                "2",
                "--max-time",
                "90",
                "--user-agent",
                USER_AGENT,
                "--output",
                str(temporary),
                candidate,
            ],
            check=False,
        )
        if result.returncode == 0 and temporary.exists() and temporary.stat().st_size > 0:
            break
    else:
        raise RuntimeError(f"Unable to fetch curated source from approved mirrors: {attempted}")
    if not temporary.exists() or temporary.stat().st_size == 0:
        raise RuntimeError(f"Empty curated source: {url}")
    if temporary.stat().st_size > max_bytes:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Curated source exceeds the size limit: {url}")
    temporary.replace(destination)
    time.sleep(0.65 if "upload.wikimedia.org" in url else 0.04)


def source_html(config: dict[str, Any], *, art: bool = False) -> Path:
    ebook_id = int(config["artEbookId"] if art else config["ebookId"])
    source_url = str(config["artSourceUrl"] if art else config["sourceUrl"])
    cache_path = CACHE_ROOT / config["slug"] / ("art-source.html" if art else "text-source.html")
    temporary_source = Path(f"/private/tmp/ss-pg-{ebook_id}.html")
    if not cache_path.exists() and temporary_source.is_file():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(temporary_source, cache_path)
    download(source_url, cache_path)
    return cache_path


def normalize_space(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r" *\n *", " ", value)
    return value.strip()


def classes(tag: Tag) -> set[str]:
    return {str(item).strip().lower() for item in tag.get("class", [])}


def has_excluded_ancestor(tag: Tag) -> bool:
    current: Tag | None = tag
    while isinstance(current, Tag):
        current_classes = classes(current)
        if current_classes & EXCLUDED_CLASSES:
            return True
        if any(
            token in class_name
            for class_name in current_classes
            for token in ("advert", "book-list", "endnote", "footnote", "transcrib")
        ):
            return True
        identity = str(current.get("id") or "").lower()
        if any(token in identity for token in ("transcrib", "pg-footer", "pg-header", "footnote")):
            return True
        parent = current.parent
        current = parent if isinstance(parent, Tag) else None
    return False


def clean_fragment(tag: Tag) -> Tag:
    clone_soup = BeautifulSoup(str(tag), "html.parser")
    clone = clone_soup.find(tag.name)
    assert isinstance(clone, Tag)
    for selector in (
        ".pagenum",
        ".page",
        ".pb",
        ".sidenote",
        "a[title^='Go to page']",
        "span[id^='Page_']",
    ):
        for artifact in clone.select(selector):
            artifact.decompose()
    for line_break in clone.find_all("br"):
        line_break.replace_with("\n")
    for text_node in list(clone.find_all(string=True)):
        cleaned = PAGE_FURNITURE.sub("", str(text_node))
        if cleaned != str(text_node):
            text_node.replace_with(cleaned)
    return clone


def safe_href(href: str, base_url: str) -> str | None:
    href = href.strip()
    if not href or href.lower().startswith(("javascript:", "data:", "vbscript:")):
        return None
    if href.startswith("#"):
        return href
    absolute = urllib.parse.urljoin(base_url, href)
    parsed = urllib.parse.urlparse(absolute)
    return absolute if parsed.scheme in {"http", "https"} else None


def inline_runs(tag: Tag, base_url: str) -> list[dict[str, Any]]:
    clone = clean_fragment(tag)
    output: list[dict[str, Any]] = []

    def walk(node: Tag | NavigableString, state: dict[str, Any]) -> None:
        if isinstance(node, NavigableString):
            value = re.sub(r"\s+", " ", str(node).replace("\xa0", " "))
            if not value:
                return
            run = {"text": value, **state}
            if output and {key: value for key, value in output[-1].items() if key != "text"} == state:
                output[-1]["text"] += value
            else:
                output.append(run)
            return
        next_state = dict(state)
        if node.name in {"cite", "em", "i"}:
            next_state["emphasis"] = True
        if node.name in {"b", "strong"}:
            next_state["strong"] = True
        if node.name == "a" and node.get("href"):
            href = safe_href(str(node["href"]), base_url)
            if href:
                next_state["href"] = href
        for child in node.children:
            if isinstance(child, (Tag, NavigableString)):
                walk(child, next_state)

    walk(clone, {})
    if not output:
        return []
    output[0]["text"] = output[0]["text"].lstrip()
    output[-1]["text"] = output[-1]["text"].rstrip()
    return [run for run in output if run["text"]]


def normalize_opening_small_caps(text: str) -> str:
    # Historic HTML often separates the first two letters around an illustrated
    # initial ("I T happened"). Rejoin only this tightly constrained opening.
    match = re.match(r"^([A-Z])\s+([A-Za-z])\s+(?=[A-Za-z])", text)
    if not match:
        return text
    return f"{match.group(1)}{match.group(2).lower()} {text[match.end():]}"


def paragraph_block(tag: Tag, base_url: str, *, force_strong: bool = False) -> dict[str, Any] | None:
    tag_classes = classes(tag)
    if any(value.startswith(("caption", "figcaption")) for value in tag_classes):
        return None
    if tag.name == "p" and tag.find("img") and not normalize_space(clean_fragment(tag).get_text(" ")):
        return None
    clone = clean_fragment(tag)
    raw_text = clone.get_text("\n")
    text = normalize_opening_small_caps(normalize_space(raw_text))
    if not text or re.fullmatch(r"(?:\[?\s*(?:Pg\.?|Page)\s*\d+\s*\]?|\{?\d+\}?)", text, re.I):
        return None
    if re.search(r"PROJECT GUTENBERG|TRANSCRIBER'?S NOTE", text, re.I):
        return None
    if tag_classes & {"asterism", "ornament", "tb"}:
        return {"type": "ornament", "mark": text or "⁂"}
    if "poem" in tag_classes or tag.name == "pre":
        lines = [normalize_space(line) for line in raw_text.splitlines()]
        lines = [line for line in lines if line]
        return {"type": "verse", "lines": lines} if lines else None
    runs = inline_runs(tag, base_url)
    block: dict[str, Any] = {"type": "paragraph", "text": text}
    if force_strong:
        block["runs"] = [{"text": text, "strong": True}]
    elif any(len(run) > 1 for run in runs) and normalize_space("".join(run["text"] for run in runs)) == text:
        block["runs"] = runs
    return block


def useful_image(tag: Tag) -> bool:
    source = str(tag.get("src") or "").strip()
    if not source or source.startswith("data:"):
        return False
    lowered = source.lower()
    if any(token in lowered for token in ("spacer", "pglaf", "gutenberg", "logo", "button", "enlarge")):
        return False
    if lowered.endswith((".svg", ".ico")):
        return False
    try:
        width = int(re.sub(r"\D", "", str(tag.get("width") or "0")) or "0")
        height = int(re.sub(r"\D", "", str(tag.get("height") or "0")) or "0")
    except ValueError:
        width = height = 0
    if width and height and max(width, height) < 96:
        return False
    return not has_excluded_ancestor(tag)


def image_source_url(tag: Tag, base_url: str) -> str:
    source = str(tag.get("src") or "")
    parent = tag.parent
    if isinstance(parent, Tag) and parent.name == "a" and parent.get("href"):
        href = str(parent["href"])
        if re.search(r"\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])", href, re.I):
            source = href
    return urllib.parse.urljoin(base_url, source)


def image_description(tag: Tag, fallback: str) -> tuple[str, str]:
    alt = normalize_space(str(tag.get("alt") or ""))
    if re.fullmatch(r"(?:image|illustration)?[_ -]*\d*[a-z]?|[a-z0-9_-]+\.(?:gif|jpe?g|png)", alt, re.I):
        alt = ""
    caption = ""
    parent = tag.parent if isinstance(tag.parent, Tag) else None
    figure = tag.find_parent(["figure", "div"])
    for candidate in (
        parent.find_next_sibling(["p", "div"]) if parent else None,
        figure.find(["figcaption", "p", "div"], class_=re.compile("caption", re.I)) if figure else None,
    ):
        if isinstance(candidate, Tag) and any(value.startswith(("caption", "cap")) for value in classes(candidate)):
            caption = normalize_space(candidate.get_text(" "))
            if caption:
                break
    description = caption or alt or fallback
    return description[:500], (caption or description)[:500]


def marker_label(marker_text: str, matched: str, index: int) -> str:
    normalized = matched.strip().rstrip(".")
    if re.fullmatch(r"[IVXLCDM]+", normalized, re.I):
        return f"Chapter {normalized.upper()}"
    if re.fullmatch(r"\d{1,2}", normalized):
        return f"Chapter {int(normalized)}"
    if normalized.lower().startswith("chapter"):
        return re.sub(r"^chapter", "Chapter", normalized, flags=re.I)
    if normalized.lower().startswith("adventure"):
        return re.sub(r"^adventure", "Adventure", normalized, flags=re.I)
    if normalized.lower().startswith("letter"):
        return re.sub(r"^letter", "Letter", normalized, flags=re.I)
    if normalized.lower().startswith("stave"):
        return re.sub(r"^stave", "Stave", normalized, flags=re.I).title()
    if normalized.lower().startswith("conclusion"):
        return "Conclusion"
    if normalized.lower().startswith("postscript"):
        return "Postscript"
    if normalized.lower() == "introduction":
        return "Introduction"
    if marker_text.lower().startswith("chapter"):
        return f"Chapter {index}"
    return normalized or f"Chapter {index}"


def select_title_node(
    soup: BeautifulSoup,
    ordered: list[Tag],
    positions: dict[int, int],
    marker: Tag,
    end_position: int,
    config: dict[str, Any],
) -> Tag | None:
    mode = config.get("titleMode")
    marker_position = positions[id(marker)]
    if normalize_space(marker.get_text(" ")).upper() == "INTRODUCTION":
        return None
    if mode == "next-heading":
        for node in ordered[marker_position + 1 : end_position]:
            if node.name in {"h1", "h2", "h3", "h4", "h5"}:
                return node
        return None
    if mode == "next-selector":
        selector = str(config.get("titleSelector") or "")
        for node in soup.select(selector):
            position = positions.get(id(node), -1)
            if marker_position < position < end_position:
                return node
    return None


def select_evenly(candidates: list[ImageCandidate], maximum: int) -> list[ImageCandidate]:
    if len(candidates) <= maximum:
        return candidates
    if maximum <= 1:
        return candidates[:1]
    indices = {round(index * (len(candidates) - 1) / (maximum - 1)) for index in range(maximum)}
    return [candidate for index, candidate in enumerate(candidates) if index in indices]


def image_block(asset_id: str, ordinal: int) -> dict[str, Any]:
    if ordinal % 11 == 8:
        return {"type": "image", "assetId": asset_id, "placement": "plate", "align": "plate"}
    return {
        "type": "image",
        "assetId": asset_id,
        "placement": "inline",
        "align": "left" if ordinal % 2 == 0 else "right",
    }


def first_letter(blocks: Iterable[dict[str, Any]]) -> str:
    for block in blocks:
        if block.get("type") != "paragraph":
            continue
        match = re.search(r"[A-Za-z]", str(block.get("text") or ""))
        if match:
            return match.group(0).upper()
    return "A"


def register_candidate(
    tag: Tag,
    *,
    base_url: str,
    ebook_id: int,
    chapter_index: int | None,
    creator: str,
    order: int,
    candidates: list[ImageCandidate],
    seen_urls: set[str],
) -> str | None:
    if not useful_image(tag):
        return None
    source_url = image_source_url(tag, base_url)
    if source_url in seen_urls:
        return None
    seen_urls.add(source_url)
    key = f"candidate-{len(candidates) + 1:04d}"
    fallback = f"Illustration from {'the opening' if chapter_index is None else f'chapter {chapter_index + 1}'}"
    alt, caption = image_description(tag, fallback)
    candidates.append(
        ImageCandidate(
            key=key,
            source_url=source_url,
            credit_url=source_url,
            source_ebook_id=ebook_id,
            chapter_index=chapter_index,
            alt=alt,
            caption=caption,
            creator=creator,
            order=order,
        )
    )
    return key


def plain_metadata(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value", "")
    if not isinstance(value, str):
        return ""
    return normalize_space(BeautifulSoup(value, "html.parser").get_text(" "))


def register_commons_candidates(
    config: dict[str, Any],
    candidates: list[ImageCandidate],
    seen_urls: set[str],
) -> None:
    category = str(config.get("commonsCategory") or "").strip()
    if not category:
        return
    api_url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": f"Category:{category}",
            "gcmtype": "file",
            "gcmlimit": 80,
            "prop": "imageinfo|info",
            "iiprop": "url|mime|size|extmetadata",
            "iiurlwidth": 1800,
            "inprop": "url",
            "format": "json",
            "formatversion": 2,
        }
    )
    metadata_path = CACHE_ROOT / config["slug"] / "commons-images.json"
    download(api_url, metadata_path, max_bytes=8 * 1024 * 1024)
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    pages = sorted(payload.get("query", {}).get("pages", []), key=lambda page: str(page.get("title", "")))
    file_pattern = (
        re.compile(str(config["commonsFileRegex"]), re.I)
        if config.get("commonsFileRegex")
        else None
    )
    for page in pages:
        if file_pattern and not file_pattern.search(str(page.get("title") or "")):
            continue
        image_info = (page.get("imageinfo") or [None])[0]
        if not isinstance(image_info, dict):
            continue
        mime = str(image_info.get("mime") or "")
        width = int(image_info.get("width") or 0)
        height = int(image_info.get("height") or 0)
        if mime not in {"image/jpeg", "image/png", "image/webp"} or max(width, height) < 700:
            continue
        metadata = image_info.get("extmetadata") or {}
        license_label = plain_metadata(metadata.get("LicenseShortName")) or plain_metadata(metadata.get("UsageTerms"))
        license_code = plain_metadata(metadata.get("License"))
        rights_text = f"{license_label} {license_code}".lower()
        if not any(token in rights_text for token in ("public domain", "cc0", "cc-zero", "pdm", "pd-old", "pd-us")):
            continue
        source_url = str(image_info.get("thumburl") or image_info.get("url") or "")
        if not source_url or source_url in seen_urls:
            continue
        seen_urls.add(source_url)
        page_url = str(page.get("canonicalurl") or "")
        if not page_url:
            page_url = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(
                str(page.get("title") or "").replace(" ", "_"), safe=":_/"
            )
        creator = plain_metadata(metadata.get("Artist")) or str(config["illustrator"])
        description = (
            plain_metadata(metadata.get("ImageDescription"))
            or plain_metadata(metadata.get("ObjectName"))
            or normalize_space(str(page.get("title") or "").removeprefix("File:"))
            or f"Historic illustration for {config['title']}"
        )
        key = f"candidate-{len(candidates) + 1:04d}"
        candidates.append(
            ImageCandidate(
                key=key,
                source_url=source_url,
                credit_url=page_url,
                source_ebook_id=None,
                chapter_index=None,
                alt=description[:500],
                caption=description[:500],
                creator=creator[:300],
                order=10_000_000 + len(candidates),
                license_label=license_label or "Public domain",
            )
        )


def build_story(config: dict[str, Any], text_path: Path) -> dict[str, Any]:
    base_url = str(config["sourceUrl"])
    ebook_id = int(config["ebookId"])
    soup = BeautifulSoup(text_path.read_text(encoding="utf-8", errors="replace"), "html.parser")
    ordered = list(soup.find_all(True))
    positions = {id(tag): index for index, tag in enumerate(ordered)}
    pattern = re.compile(str(config["chapterMarkerRegex"]), re.I)
    skip_heading_pattern = (
        re.compile(str(config["skipHeadingRegex"]), re.I)
        if config.get("skipHeadingRegex")
        else None
    )
    marker_tags = set(config["chapterMarkerTags"])
    markers = [
        tag
        for tag in ordered
        if tag.name in marker_tags and pattern.search(normalize_space(tag.get_text(" ")))
    ]
    expected = int(config["expectedChapters"])
    if len(markers) != expected:
        headings = [normalize_space(tag.get_text(" ")) for tag in ordered if tag.name in marker_tags]
        raise RuntimeError(
            f"{config['slug']}: found {len(markers)} chapter markers, expected {expected}. "
            f"Candidate headings: {headings[:12]}"
        )

    document_end = len(ordered)
    for tag in ordered[positions[id(markers[-1])] + 1 :]:
        tag_classes = classes(tag)
        identity = str(tag.get("id") or "").lower()
        own_text = normalize_space(tag.get_text(" "))
        direct_text = normalize_space(
            " ".join(str(node) for node in tag.find_all(string=True, recursive=False))
        )
        is_trailing_container = bool(tag_classes & {"books", "footnote", "footnotes", "tnote"})
        is_print_line = bool(
            re.match(
                r"^(?:COPYRIGHT[, ]|PRINTED (?:BY|IN)|LONDON\s*:\s*PRINTED|CHISWICK PRESS|GROSSET\s*&\s*DUNLAP)",
                direct_text,
                re.I,
            )
        )
        is_end_mark = direct_text.upper().rstrip(".") == "THE END"
        is_repeated_title = tag.name == "p" and own_text.casefold() == str(config["title"]).casefold()
        configured_end = bool(
            config.get("endMarkerRegex")
            and re.search(str(config["endMarkerRegex"]), own_text, re.I)
        )
        if (
            "pg-boilerplate" in tag_classes
            or "pg-end" in identity
            or own_text.startswith("*** END OF THE PROJECT GUTENBERG")
            or is_trailing_container
            or is_print_line
            or is_end_mark
            or is_repeated_title
            or configured_end
        ):
            document_end = positions[id(tag)]
            break

    candidates: list[ImageCandidate] = []
    seen_urls: set[str] = set()
    raw_chapters: list[dict[str, Any]] = []
    first_marker_position = positions[id(markers[0])]

    for tag in ordered[:first_marker_position]:
        if tag.name == "img":
            register_candidate(
                tag,
                base_url=base_url,
                ebook_id=ebook_id,
                chapter_index=None,
                creator=str(config.get("sourceImageCreator") or config["illustrator"]),
                order=positions[id(tag)],
                candidates=candidates,
                seen_urls=seen_urls,
            )

    restored_initials = config.get("restoredInitials") or []
    for chapter_index, marker in enumerate(markers):
        start = positions[id(marker)]
        end = positions[id(markers[chapter_index + 1])] if chapter_index + 1 < len(markers) else document_end
        marker_text = normalize_space(marker.get_text(" "))
        match = pattern.search(marker_text)
        assert match is not None
        matched = match.group(0)
        label = marker_label(marker_text, matched, chapter_index + 1)
        if config.get("sequentialLabels"):
            label = f"Chapter {chapter_index + 1}"
        title_node = select_title_node(soup, ordered, positions, marker, end, config)
        title_node_position = positions.get(id(title_node), -1) if title_node else -1

        title = ""
        if config.get("titleMode") == "inline":
            title = normalize_space(f"{marker_text[:match.start()]} {marker_text[match.end():]}")
            title = re.sub(r"^(?:ADVENTURES OF SHERLOCK HOLMES\s*)", "", title, flags=re.I)
        elif title_node is not None:
            title = normalize_space(title_node.get_text(" "))
        if not title:
            title = label

        blocks: list[dict[str, Any]] = []
        for node in ordered[start + 1 : end]:
            if has_excluded_ancestor(node):
                continue
            position = positions[id(node)]
            if position == title_node_position:
                continue
            if title_node is not None and title_node in node.parents:
                continue
            if node.name == "img":
                key = register_candidate(
                    node,
                    base_url=base_url,
                    ebook_id=ebook_id,
                    chapter_index=chapter_index,
                    creator=str(config.get("sourceImageCreator") or config["illustrator"]),
                    order=position,
                    candidates=candidates,
                    seen_urls=seen_urls,
                )
                if key:
                    blocks.append({"type": "image-candidate", "key": key})
                continue
            if node.name == "hr":
                if classes(node) & {"tb", "thoughtbreak"}:
                    blocks.append({"type": "ornament", "mark": "⁂"})
                continue
            if node.name in {"h1", "h2", "h3", "h4", "h5"}:
                # Chapter markers and title descendants are handled separately.
                if node in markers or marker in node.parents:
                    continue
                heading_text = normalize_space(node.get_text(" "))
                if not heading_text or re.search(r"CONTENTS|ILLUSTRATIONS", heading_text, re.I):
                    continue
                if skip_heading_pattern and skip_heading_pattern.search(heading_text):
                    continue
                if re.fullmatch(r"[IVXLCDM]+", heading_text):
                    blocks.append({"type": "ornament", "mark": heading_text})
                else:
                    block = paragraph_block(node, base_url, force_strong=True)
                    if block:
                        blocks.append(block)
                continue
            if node.name in {"p", "pre"}:
                block = paragraph_block(node, base_url)
                if block:
                    blocks.append(block)
                continue
            if node.name == "div" and classes(node) & {"cap", "first-para", "flushp", "nind", "noindent", "pfirst"}:
                if not node.find(["p", "pre"]):
                    block = paragraph_block(node, base_url)
                    if block:
                        blocks.append(block)

        if chapter_index < len(restored_initials):
            initial = str(restored_initials[chapter_index])[:1]
            for block in blocks:
                if block.get("type") != "paragraph":
                    continue
                text = str(block.get("text") or "")
                if text and text[0].islower():
                    block["text"] = initial + text
                    block.pop("runs", None)
                break

        raw_chapters.append(
            {
                "id": f"chapter-{chapter_index + 1:03d}",
                "number": chapter_index + 1,
                "label": label,
                "title": title,
                "blocks": blocks,
            }
        )

    if config.get("artEbookId"):
        art_path = source_html(config, art=True)
        art_soup = BeautifulSoup(art_path.read_text(encoding="utf-8", errors="replace"), "html.parser")
        art_base_url = str(config["artSourceUrl"])
        art_image_pattern = (
            re.compile(str(config["artImageUrlRegex"]), re.I)
            if config.get("artImageUrlRegex")
            else None
        )
        for order, tag in enumerate(art_soup.find_all("img"), start=len(ordered)):
            if config.get("skipArtHeadingImages") and tag.find_parent(["h1", "h2", "h3", "h4", "h5"]):
                continue
            if art_image_pattern and not art_image_pattern.search(image_source_url(tag, art_base_url)):
                continue
            register_candidate(
                tag,
                base_url=art_base_url,
                ebook_id=int(config["artEbookId"]),
                chapter_index=None,
                creator=str(config["illustrator"]),
                order=order,
                candidates=candidates,
                seen_urls=seen_urls,
            )

    register_commons_candidates(config, candidates, seen_urls)

    selected = select_evenly(candidates, int(config.get("maxImages") or 48))
    selected_keys = {candidate.key for candidate in selected}
    intro_candidates = selected[: min(3, len(selected))]
    intro_keys = {candidate.key for candidate in intro_candidates}
    key_to_id: dict[str, str] = {}
    assets: list[dict[str, Any]] = []
    cache_images = CACHE_ROOT / config["slug"] / "images"

    for ordinal, candidate in enumerate(selected, start=1):
        asset_id = f"art-{ordinal:03d}"
        key_to_id[candidate.key] = asset_id
        suffix = Path(urllib.parse.urlparse(candidate.source_url).path).suffix.lower()
        if suffix not in {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}:
            suffix = ".img"
        source_key = hashlib.sha256(candidate.source_url.encode("utf-8")).hexdigest()[:12]
        original = cache_images / f"{asset_id}-{source_key}{suffix}"
        download(candidate.source_url, original)
        assets.append(
            {
                "id": asset_id,
                "type": "cover" if ordinal == 1 else "illustration",
                "path": f"/stories/{config['slug']}/images/{asset_id}.webp",
                "alt": candidate.alt,
                "caption": candidate.caption,
                "creator": candidate.creator,
                "sourceUrl": candidate.credit_url,
                "sourceSha256": sha256_path(original),
                "sourceFile": str(original.relative_to(PROJECT_ROOT)),
                "publicDomain": True,
                **(
                    {"sourceEbookId": candidate.source_ebook_id}
                    if candidate.source_ebook_id is not None
                    else {"sourceProvider": "Wikimedia Commons"}
                ),
                **({"license": candidate.license_label} if candidate.license_label else {}),
            }
        )

    image_ordinal = 0
    placed_keys: set[str] = set()
    chapters: list[dict[str, Any]] = []
    for raw_chapter in raw_chapters:
        blocks: list[dict[str, Any]] = []
        for block in raw_chapter["blocks"]:
            if block.get("type") != "image-candidate":
                blocks.append(block)
                continue
            key = str(block["key"])
            if key not in selected_keys or key in intro_keys:
                continue
            blocks.append(image_block(key_to_id[key], image_ordinal))
            image_ordinal += 1
            placed_keys.add(key)
        raw_chapter["blocks"] = blocks
        raw_chapter["firstLetter"] = first_letter(blocks)
        chapters.append(raw_chapter)

    floating = [candidate for candidate in selected if candidate.key not in intro_keys | placed_keys]
    for index, candidate in enumerate(floating):
        chapter_index = round(index * (len(chapters) - 1) / max(1, len(floating) - 1))
        chapter = chapters[chapter_index]
        prose_positions = [
            block_index
            for block_index, block in enumerate(chapter["blocks"])
            if block.get("type") in {"paragraph", "verse"}
        ]
        insertion = prose_positions[max(0, len(prose_positions) // 2)] + 1 if prose_positions else 0
        chapter["blocks"].insert(insertion, image_block(key_to_id[candidate.key], image_ordinal))
        image_ordinal += 1
        placed_keys.add(candidate.key)

    for chapter in chapters:
        if not any(block.get("type") in {"paragraph", "verse"} for block in chapter["blocks"]):
            raise RuntimeError(f"{config['slug']}: chapter {chapter['number']} has no readable text")

    rights_scope = str(config["rightsScope"])
    rights_notice = (
        "Public domain in the United States; international restrictions apply to this illustrated edition."
        if rights_scope == "united-states-only"
        else "Public domain in the United States; checked against a typical life-plus-70 term."
    )
    source_record: dict[str, Any] = {
        "name": "Public-domain source edition",
        "textEbookId": ebook_id,
        "textCatalogUrl": f"https://www.gutenberg.org/ebooks/{ebook_id}",
        "textUrl": base_url,
        "textSha256": sha256_path(text_path),
        "accessed": date.today().isoformat(),
        "normalization": {
            "parser": "storybook-scrolls-curated-registry",
            "version": 2,
            "sourceBoilerplateRemoved": True,
            "rawHtmlStoredPublicly": False,
            "notes": "Only configured story chapter regions are retained; page furniture, contents, footnotes, source wrappers, and transcriber notes are removed.",
        },
    }
    if config.get("artEbookId"):
        art_path = CACHE_ROOT / config["slug"] / "art-source.html"
        source_record.update(
            {
                "illustrationEbookId": int(config["artEbookId"]),
                "illustrationCatalogUrl": f"https://www.gutenberg.org/ebooks/{int(config['artEbookId'])}",
                "illustrationIndexUrl": str(config["artSourceUrl"]),
                "illustrationIndexSha256": sha256_path(art_path),
            }
        )
    if config.get("commonsCategory"):
        source_record["illustrationCollectionUrl"] = (
            "https://commons.wikimedia.org/wiki/Category:"
            + urllib.parse.quote(str(config["commonsCategory"]).replace(" ", "_"), safe="()_-")
        )

    story: dict[str, Any] = {
        "schemaVersion": 1,
        "slug": config["slug"],
        "title": config["title"],
        "subtitle": config["subtitle"],
        "author": config["author"],
        "illustrator": config["illustrator"],
        "language": "en",
        "kind": "curated",
        "coverAssetId": assets[0]["id"] if assets else None,
        "intro": {
            "kind": "featured-scrollytelling",
            "frames": [key_to_id[candidate.key] for candidate in intro_candidates],
            "credit": f"Illustrations by {config['illustrator']}",
        },
        "theme": {
            "id": config["illuminatedSet"],
            "accent": config["accent"],
            "illuminatedSetId": f"illuminatedletters:{config['illuminatedSet']}",
        },
        "source": source_record,
        "rights": {
            "status": "public-domain-in-the-united-states",
            "scope": rights_scope,
            "publicationYear": int(config["publicationYear"]),
            "notice": rights_notice,
            "jurisdictionNote": config["rightsNote"],
        },
        "contentWarnings": config.get("contentWarnings", []),
        "assets": assets,
        "chapters": chapters,
    }
    validate_story(story, expected)
    return story


def validate_story(story: dict[str, Any], expected_chapters: int) -> None:
    if len(story["chapters"]) != expected_chapters:
        raise RuntimeError(f"{story['slug']}: incorrect chapter count")
    asset_ids = {asset["id"] for asset in story["assets"]}
    if len(asset_ids) != len(story["assets"]):
        raise RuntimeError(f"{story['slug']}: duplicate asset id")
    references = list(story["intro"]["frames"])
    for chapter in story["chapters"]:
        if not chapter["blocks"] or not chapter["firstLetter"]:
            raise RuntimeError(f"{story['slug']}: empty chapter {chapter['number']}")
        for block in chapter["blocks"]:
            unknown_keys = set(block) - BLOCK_KEYS
            if unknown_keys:
                raise RuntimeError(f"{story['slug']}: unsafe AST keys {sorted(unknown_keys)}")
            if block["type"] == "image":
                if block["assetId"] not in asset_ids:
                    raise RuntimeError(f"{story['slug']}: unresolved image {block['assetId']}")
                references.append(block["assetId"])
    if len(references) != len(set(references)):
        raise RuntimeError(f"{story['slug']}: an illustration is referenced more than once")
    if set(references) != asset_ids:
        missing = sorted(asset_ids - set(references))
        raise RuntimeError(f"{story['slug']}: unplaced illustrations: {missing}")
    combined_text = "\n".join(
        str(block.get("text") or "\n".join(block.get("lines") or []))
        for chapter in story["chapters"]
        for block in chapter["blocks"]
    )
    if re.search(r"PROJECT GUTENBERG|END OF THE PROJECT|TRANSCRIBER'?S NOTE", combined_text, re.I):
        raise RuntimeError(f"{story['slug']}: source boilerplate leaked into the reading text")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", action="append", help="Build only the selected slug (repeatable).")
    args = parser.parse_args()
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    selected_slugs = set(args.slug or [])
    configs = [config for config in registry if not selected_slugs or config["slug"] in selected_slugs]
    unknown = selected_slugs - {config["slug"] for config in configs}
    if unknown:
        raise SystemExit(f"Unknown curated slug(s): {', '.join(sorted(unknown))}")

    results: list[dict[str, Any]] = []
    for config in configs:
        text_path = source_html(config)
        story = build_story(config, text_path)
        write_json(PUBLIC_ROOT / config["slug"] / "story.json", story)
        result = {
            "slug": config["slug"],
            "chapters": len(story["chapters"]),
            "assets": len(story["assets"]),
            "blocks": sum(len(chapter["blocks"]) for chapter in story["chapters"]),
        }
        results.append(result)
        print(json.dumps(result), flush=True)
    print(json.dumps({"stories": results}, indent=2))


if __name__ == "__main__":
    main()

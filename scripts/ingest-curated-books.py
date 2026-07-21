#!/usr/bin/env python3
"""Build deterministic, display-safe The Story Scrolls ASTs for curated books.

The source editions are fixed public-domain eBooks.  This script deliberately
keeps raw HTML and original image downloads out of ``public``; the companion
``optimize-curated-assets.mjs`` script converts the original images to WebP and
removes the temporary ``sourceFile`` fields from the public manifests.

Dependencies: Python 3.11+ and Beautiful Soup 4.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.parse
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup, NavigableString, Tag
from source_mirrors import source_download_candidates


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = PROJECT_ROOT / "public" / "stories"
CACHE_ROOT = PROJECT_ROOT / ".cache" / "curated-books"
ACCESSED_DATE = "2026-07-18"
USER_AGENT = "The Story Scrolls curated-edition builder/1.0 (https://thestoryscrolls.com/)"

LEGACY_SOURCE_URLS = {
    "alice": "https://www.gutenberg.org/files/11/11-h/11-h.htm",
    "alice-art": "https://www.gutenberg.org/files/114/114-h/114-h.htm",
    "oz": "https://www.gutenberg.org/files/43936/43936-h/43936-h.htm",
}

ALICE_SLUG = "alice-in-wonderland"
OZ_SLUG = "the-wonderful-wizard-of-oz"

ALICE_TITLES = [
    "Down the Rabbit-Hole",
    "The Pool of Tears",
    "A Caucus-Race and a Long Tale",
    "The Rabbit Sends in a Little Bill",
    "Advice from a Caterpillar",
    "Pig and Pepper",
    "A Mad Tea-Party",
    "The Queen's Croquet-Ground",
    "The Mock Turtle's Story",
    "The Lobster Quadrille",
    "Who Stole the Tarts?",
    "Alice's Evidence",
]

OZ_TITLES = [
    "The Cyclone",
    "The Council with the Munchkins",
    "How Dorothy Saved the Scarecrow",
    "The Road Through the Forest",
    "The Rescue of the Tin Woodman",
    "The Cowardly Lion",
    "The Journey to the Great Oz",
    "The Deadly Poppy Field",
    "The Queen of the Field Mice",
    "The Guardian of the Gates",
    "The Wonderful Emerald City of Oz",
    "The Search for the Wicked Witch",
    "The Rescue",
    "The Winged Monkeys",
    "The Discovery of Oz, the Terrible",
    "The Magic Art of the Great Humbug",
    "How the Balloon Was Launched",
    "Away to the South",
    "Attacked by the Fighting Trees",
    "The Dainty China Country",
    "The Lion Becomes the King of Beasts",
    "The Country of the Quadlings",
    "The Good Witch Grants Dorothy's Wish",
    "Home Again",
]

# The illustrations are in narrative order except for image 1, the courtroom
# frontispiece.  These chapter ranges follow Tenniel's scenes in eBook 114.
ALICE_IMAGE_CHAPTERS = {
    1: [2, 3, 4, 5],
    2: [6, 7, 8],
    3: [9, 10],
    4: [11, 12, 13, 14],
    5: [15, 16, 17, 18, 19],
    6: [20, 21, 22, 23, 24],
    7: [25, 26, 27],
    8: [28, 29, 30, 31],
    9: [32, 33, 34],
    10: [35, 36],
    11: [37, 38, 39],
    12: [1, 40, 41, 42],
}

# Featured intros reserve these illustrations so an image is not repeated in
# both the bespoke opening and the reading stream.
ALICE_INTRO_ASSETS = ["alice02", "alice07", "alice25", "alice42"]
OZ_INTRO_ASSETS = ["i009_edit", "i076_edit", "i142_edit", "i296_edit"]


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def roman(number: int) -> str:
    values = ((10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"))
    output = ""
    for value, glyph in values:
        while number >= value:
            output += glyph
            number -= value
    return output


def download(url: str, destination: Path) -> None:
    """Download an immutable source asset once, with a small polite delay."""

    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    # The host uses the system curl trust store; the standalone Python runtime
    # on this machine does not inherit it.  No shell is involved.
    attempted: list[str] = []
    for candidate in source_download_candidates(url):
        attempted.append(candidate)
        temporary.unlink(missing_ok=True)
        result = subprocess.run(
            [
                "curl",
                "-fsSL",
                "--retry",
                "2",
                "--max-time",
                "45",
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
    if temporary.stat().st_size > 25 * 1024 * 1024:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Refusing oversized curated asset: {url}")
    temporary.replace(destination)
    time.sleep(0.06)


def clean_fragment(tag: Tag) -> Tag:
    """Clone a source element and remove non-story display artifacts."""

    clone_soup = BeautifulSoup(str(tag), "html.parser")
    clone = clone_soup.find(tag.name)
    assert isinstance(clone, Tag)
    for selector in (
        ".pagenum",
        ".shape_wrap_left",
        ".shape_wrap_right",
        ".left",
        ".right",
    ):
        for artifact in clone.select(selector):
            artifact.decompose()
    for line_break in clone.find_all("br"):
        line_break.replace_with("\n")
    return clone


def normalize_prose(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r" *\n *", " ", value)
    return value.strip()


def inline_runs(tag: Tag) -> list[dict[str, Any]]:
    """Return sanitized inline formatting without carrying source HTML."""

    clone = clean_fragment(tag)
    runs: list[dict[str, Any]] = []

    def walk(node: Tag | NavigableString, state: dict[str, Any]) -> None:
        if isinstance(node, NavigableString):
            value = re.sub(r"\s+", " ", str(node).replace("\xa0", " "))
            if not value:
                return
            run: dict[str, Any] = {"text": value}
            run.update(state)
            if runs and {k: v for k, v in runs[-1].items() if k != "text"} == state:
                runs[-1]["text"] += value
            else:
                runs.append(run)
            return

        next_state = dict(state)
        if node.name in {"i", "em", "cite"}:
            next_state["emphasis"] = True
        if node.name in {"b", "strong"}:
            next_state["strong"] = True
        if node.name == "a" and node.get("href"):
            href = str(node["href"]).strip()
            if href.startswith(("https://", "http://", "#")):
                next_state["href"] = href
        for child in node.children:
            if isinstance(child, (Tag, NavigableString)):
                walk(child, next_state)

    walk(clone, {})
    if not runs:
        return []
    runs[0]["text"] = runs[0]["text"].lstrip()
    runs[-1]["text"] = runs[-1]["text"].rstrip()
    return [run for run in runs if run["text"]]


def paragraph_block(tag: Tag) -> dict[str, Any] | None:
    classes = {str(item).lower() for item in tag.get("class", [])}
    if any(item.startswith("caption") for item in classes):
        return None
    clean = clean_fragment(tag)
    # No separator: inline tags can split a single word (for example the
    # decorated "A" in "Aunt" in Oz chapter XXIV).
    text = normalize_prose(clean.get_text())
    if not text:
        return None
    if classes & {"asterism", "tb", "ornament"}:
        return {"type": "ornament", "mark": text or "⁂"}
    if "poem" in classes or ("center" in classes and "\n" in clean.get_text()):
        lines = [normalize_prose(line) for line in clean.get_text().splitlines()]
        return {"type": "verse", "lines": [line for line in lines if line]}
    runs = inline_runs(tag)
    block: dict[str, Any] = {"type": "paragraph", "text": text}
    if any(len(run) > 1 for run in runs):
        block["runs"] = runs
    return block


def preformatted_block(tag: Tag, *, chapter_number: int) -> dict[str, Any] | None:
    value = tag.get_text().replace("\r\n", "\n").replace("\r", "\n")
    lines = value.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return None
    minimum_indent = min((len(line) - len(line.lstrip()) for line in lines if line.strip()), default=0)
    lines = [line[minimum_indent:].rstrip() for line in lines]
    block: dict[str, Any] = {"type": "verse", "lines": lines, "preserveIndent": True}
    if chapter_number == 3 and len(lines) > 20:
        block["shape"] = "mouse-tail"
    elif chapter_number == 2:
        block["shape"] = "address"
    return block


def first_letter(blocks: Iterable[dict[str, Any]]) -> str:
    for block in blocks:
        if block.get("type") != "paragraph":
            continue
        match = re.search(r"[A-Za-z]", str(block.get("text", "")))
        if match:
            return match.group(0).upper()
    return "A"


def image_block(asset_id: str, ordinal: int) -> dict[str, Any]:
    if ordinal % 9 == 7:
        return {"type": "image", "assetId": asset_id, "placement": "plate", "align": "center"}
    return {
        "type": "image",
        "assetId": asset_id,
        "placement": "inline",
        "align": "left" if ordinal % 2 == 0 else "right",
    }


def interleave_images(
    blocks: list[dict[str, Any]], asset_ids: list[str], image_ordinal: int
) -> tuple[list[dict[str, Any]], int]:
    if not asset_ids:
        return blocks, image_ordinal
    output = list(blocks)
    # Place illustrations after prose has begun and spread them across the chapter.
    denominator = len(asset_ids) + 1
    insertions: list[tuple[int, dict[str, Any]]] = []
    for index, asset_id in enumerate(asset_ids, start=1):
        at = max(1, round(len(blocks) * index / denominator))
        insertions.append((at, image_block(asset_id, image_ordinal)))
        image_ordinal += 1
    for offset, (at, block) in enumerate(insertions):
        output.insert(min(at + offset, len(output)), block)
    return output, image_ordinal


def public_domain_rights(*, publication_year: int, notes: str) -> dict[str, Any]:
    return {
        "status": "public-domain-in-the-united-states",
        "publicationYear": publication_year,
        "licenseLabel": "Public domain in the United States",
        "jurisdictionNote": "Readers outside the United States should check local copyright law.",
        "notes": notes,
    }


def alice_asset_records(art_soup: BeautifulSoup) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    cache_directory = CACHE_ROOT / ALICE_SLUG / "images"
    for number in range(1, 43):
        asset_id = f"alice{number:02d}"
        image = art_soup.find("img", src=re.compile(rf"alice{number:02d}a\.gif$", re.I))
        if not isinstance(image, Tag):
            raise RuntimeError(f"Missing Tenniel illustration {number}")
        source_path = str(image["src"])
        source_url = urllib.parse.urljoin(
            "https://www.gutenberg.org/files/114/114-h/114-h.htm", source_path
        )
        original = cache_directory / Path(source_path).name
        download(source_url, original)
        caption = normalize_prose(str(image.get("alt") or f"Tenniel illustration {number}"))
        records.append(
            {
                "id": asset_id,
                "type": "illustration",
                "path": f"/stories/{ALICE_SLUG}/images/{asset_id}.webp",
                "alt": caption,
                "caption": caption,
                "creator": "Sir John Tenniel",
                "sourceUrl": source_url,
                "sourceEbookId": 114,
                "sourceSha256": sha256_path(original),
                "sourceFile": str(original.relative_to(PROJECT_ROOT)),
                "publicDomain": True,
            }
        )
    return records


def build_alice(text_path: Path, art_index_path: Path) -> dict[str, Any]:
    text_soup = BeautifulSoup(text_path.read_text(encoding="utf-8"), "html.parser")
    art_soup = BeautifulSoup(art_index_path.read_text(encoding="utf-8"), "html.parser")
    assets = alice_asset_records(art_soup)
    chapters: list[dict[str, Any]] = []
    image_ordinal = 0

    for chapter_number, title in enumerate(ALICE_TITLES, start=1):
        marker = text_soup.find(id=f"chap{chapter_number:02d}")
        if not isinstance(marker, Tag) or not isinstance(marker.parent, Tag):
            raise RuntimeError(f"Missing Alice chapter {chapter_number}")
        chapter_container = marker.parent.parent
        if not isinstance(chapter_container, Tag):
            raise RuntimeError(f"Malformed Alice chapter {chapter_number}")
        blocks: list[dict[str, Any]] = []
        for child in chapter_container.children:
            if not isinstance(child, Tag) or child.name == "h2":
                continue
            block: dict[str, Any] | None = None
            if child.name == "p":
                block = paragraph_block(child)
            elif child.name == "pre":
                block = preformatted_block(child, chapter_number=chapter_number)
            elif child.name == "hr" and "tb" in child.get("class", []):
                block = {"type": "ornament", "mark": "⁂"}
            if block:
                blocks.append(block)

        inline_assets = [
            f"alice{number:02d}"
            for number in ALICE_IMAGE_CHAPTERS[chapter_number]
            if f"alice{number:02d}" not in ALICE_INTRO_ASSETS
        ]
        blocks, image_ordinal = interleave_images(blocks, inline_assets, image_ordinal)
        chapters.append(
            {
                "id": f"chapter-{chapter_number:02d}",
                "number": chapter_number,
                "label": f"Chapter {roman(chapter_number)}",
                "title": title,
                "firstLetter": first_letter(blocks),
                "blocks": blocks,
            }
        )

    return {
        "schemaVersion": 1,
        "slug": ALICE_SLUG,
        "title": "Alice's Adventures in Wonderland",
        "subtitle": "An illustrated public-domain edition",
        "author": "Lewis Carroll",
        "illustrator": "Sir John Tenniel",
        "language": "en",
        "kind": "curated",
        "coverAssetId": "alice02",
        "intro": {
            "kind": "featured-scrollytelling",
            "frames": ALICE_INTRO_ASSETS,
            "credit": "Illustrations by Sir John Tenniel",
        },
        "theme": {
            "id": "manuscript-flowers",
            "accent": "#7b2638",
            "illuminatedSetId": "illuminatedletters:fleur-de-lis-garden-gold",
        },
        "source": {
            "textEbookId": 11,
            "textCatalogUrl": "https://www.gutenberg.org/ebooks/11",
            "textUrl": "https://www.gutenberg.org/files/11/11-h/11-h.htm",
            "textSha256": sha256_path(text_path),
            "illustrationEbookId": 114,
            "illustrationCatalogUrl": "https://www.gutenberg.org/ebooks/114",
            "illustrationIndexUrl": "https://www.gutenberg.org/files/114/114-h/114-h.htm",
            "illustrationIndexSha256": sha256_path(art_index_path),
            "accessed": ACCESSED_DATE,
            "normalization": {
                "parser": "storybook-scrolls-source-edition",
                "version": 1,
                "sourceBoilerplateRemoved": True,
                "notes": "Chapter containers only; page furniture removed; poetry and the Mouse's shaped tale retained as verse blocks.",
            },
        },
        "rights": public_domain_rights(
            publication_year=1865,
            notes="Lewis Carroll's text and John Tenniel's original illustrations are public domain in the United States.",
        ),
        "assets": assets,
        "chapters": chapters,
    }


def descendant_blocks(
    node: Tag,
    *,
    chapter_number: int,
    register_image: Any,
) -> list[dict[str, Any]]:
    """Flatten one top-level Oz layout element without duplicating nested text."""

    classes = {str(item).lower() for item in node.get("class", [])}
    if classes & {"shape_wrap_left", "shape_wrap_right", "left", "right", "tn"}:
        return []
    if node.name == "p":
        block = paragraph_block(node)
        return [block] if block else []
    if node.name == "pre":
        block = preformatted_block(node, chapter_number=chapter_number)
        return [block] if block else []
    if node.name == "img":
        return [register_image(node)]
    if node.name == "hr":
        return [{"type": "ornament", "mark": "⁂"}] if "tb" in classes else []

    blocks: list[dict[str, Any]] = []
    for child in node.children:
        if not isinstance(child, Tag):
            continue
        blocks.extend(
            descendant_blocks(child, chapter_number=chapter_number, register_image=register_image)
        )
    return blocks


def build_oz(text_path: Path) -> dict[str, Any]:
    soup = BeautifulSoup(text_path.read_text(encoding="utf-8"), "html.parser")
    main = soup.find("div", class_="main")
    if not isinstance(main, Tag):
        raise RuntimeError("Missing Oz main container")

    marker_containers: list[Tag] = []
    for chapter_number in range(1, 25):
        marker = soup.find(id=f"Chapter_{roman(chapter_number)}")
        if not isinstance(marker, Tag) or not isinstance(marker.parent, Tag):
            raise RuntimeError(f"Missing Oz chapter {chapter_number}")
        marker_containers.append(marker.parent)

    assets: dict[str, dict[str, Any]] = {}
    chapters: list[dict[str, Any]] = []
    image_ordinal = 0
    cache_directory = CACHE_ROOT / OZ_SLUG / "images"

    def register_image(tag: Tag) -> dict[str, Any]:
        nonlocal image_ordinal
        source_path = str(tag.get("src") or "").strip()
        if not source_path.startswith("images/"):
            raise RuntimeError(f"Unexpected Oz image path: {source_path}")
        asset_id = Path(source_path).stem.lower()
        caption_node = tag.find_next_sibling("p", class_=re.compile(r"caption", re.I))
        caption = normalize_prose(
            caption_node.get_text(" ") if isinstance(caption_node, Tag) else str(tag.get("alt") or "")
        ).strip('"')
        alt = normalize_prose(str(tag.get("alt") or caption or "Illustration"))
        source_url = urllib.parse.urljoin(
            "https://www.gutenberg.org/files/43936/43936-h/43936-h.htm", source_path
        )
        original = cache_directory / Path(source_path).name
        download(source_url, original)
        if asset_id not in assets:
            assets[asset_id] = {
                "id": asset_id,
                "type": "illustration",
                "path": f"/stories/{OZ_SLUG}/images/{asset_id}.webp",
                "alt": alt,
                "caption": caption or alt,
                "creator": "W. W. Denslow",
                "sourceUrl": source_url,
                "sourceEbookId": 43936,
                "sourceSha256": sha256_path(original),
                "sourceFile": str(original.relative_to(PROJECT_ROOT)),
                "publicDomain": True,
            }
        block = image_block(asset_id, image_ordinal)
        image_ordinal += 1
        return block

    for chapter_number, title in enumerate(OZ_TITLES, start=1):
        start = marker_containers[chapter_number - 1]
        end = marker_containers[chapter_number] if chapter_number < 24 else None
        nodes: list[Tag] = []
        # Chapter XXIV's marker shares a wrap container with its complete text.
        if start.find("p") is not None:
            nodes.append(start)
        sibling = start.find_next_sibling()
        while isinstance(sibling, Tag) and sibling is not end:
            if "tn" in sibling.get("class", []):
                break
            nodes.append(sibling)
            sibling = sibling.find_next_sibling()

        blocks: list[dict[str, Any]] = []
        for node in nodes:
            blocks.extend(
                descendant_blocks(node, chapter_number=chapter_number, register_image=register_image)
            )

        # Captions were folded into their image records, so remove duplicate
        # caption paragraphs and reserve the featured opening frames.
        filtered: list[dict[str, Any]] = []
        for block in blocks:
            if block.get("type") == "image" and block.get("assetId") in OZ_INTRO_ASSETS:
                continue
            filtered.append(block)
        chapters.append(
            {
                "id": f"chapter-{chapter_number:02d}",
                "number": chapter_number,
                "label": f"Chapter {roman(chapter_number)}",
                "title": title,
                "firstLetter": first_letter(filtered),
                "blocks": filtered,
            }
        )

    missing_intro = [asset_id for asset_id in OZ_INTRO_ASSETS if asset_id not in assets]
    if missing_intro:
        raise RuntimeError(f"Missing Oz intro assets: {', '.join(missing_intro)}")

    return {
        "schemaVersion": 1,
        "slug": OZ_SLUG,
        "title": "The Wonderful Wizard of Oz",
        "subtitle": "The illustrated 1900 edition",
        "author": "L. Frank Baum",
        "illustrator": "W. W. Denslow",
        "language": "en",
        "kind": "curated",
        "coverAssetId": "i009_edit",
        "intro": {
            "kind": "featured-scrollytelling",
            "frames": OZ_INTRO_ASSETS,
            "credit": "Pictures by W. W. Denslow",
        },
        "theme": {
            "id": "seven-stone-reliquary-gold",
            "accent": "#167c5a",
            "illuminatedSetId": "illuminatedletters:seven-stone-reliquary-gold",
        },
        "source": {
            "textEbookId": 43936,
            "textCatalogUrl": "https://www.gutenberg.org/ebooks/43936",
            "textUrl": "https://www.gutenberg.org/files/43936/43936-h/43936-h.htm",
            "textSha256": sha256_path(text_path),
            "accessed": ACCESSED_DATE,
            "normalization": {
                "parser": "storybook-scrolls-source-edition",
                "version": 1,
                "sourceBoilerplateRemoved": True,
                "notes": "Only the 24 chapter regions are retained; page numbers, contents, scan furniture, and transcriber notes are removed.",
            },
        },
        "rights": public_domain_rights(
            publication_year=1900,
            notes="L. Frank Baum's text and W. W. Denslow's original illustrations are public domain in the United States.",
        ),
        "assets": list(assets.values()),
        "chapters": chapters,
    }


def validate_story(story: dict[str, Any], expected_chapters: int) -> None:
    if len(story["chapters"]) != expected_chapters:
        raise RuntimeError(f"{story['slug']}: incorrect chapter count")
    asset_ids = {asset["id"] for asset in story["assets"]}
    if len(asset_ids) != len(story["assets"]):
        raise RuntimeError(f"{story['slug']}: duplicate asset id")
    for chapter in story["chapters"]:
        if not chapter["blocks"] or not chapter["firstLetter"]:
            raise RuntimeError(f"{story['slug']}: empty chapter {chapter['number']}")
        for block in chapter["blocks"]:
            if block["type"] == "image" and block["assetId"] not in asset_ids:
                raise RuntimeError(f"{story['slug']}: unresolved image {block['assetId']}")
            if set(block) - {
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
            }:
                raise RuntimeError(f"{story['slug']}: unsafe or unknown AST block keys")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--alice-html", type=Path)
    parser.add_argument("--alice-art-html", type=Path)
    parser.add_argument("--oz-html", type=Path)
    args = parser.parse_args()

    def source_path(explicit: Path | None, name: str, filename: str) -> Path:
        if explicit is not None:
            if not explicit.is_file():
                raise SystemExit(f"Missing source HTML: {explicit}")
            return explicit
        cached = CACHE_ROOT / "source-html" / filename
        download(LEGACY_SOURCE_URLS[name], cached)
        return cached

    alice_html = source_path(args.alice_html, "alice", "alice-11.html")
    alice_art_html = source_path(args.alice_art_html, "alice-art", "alice-art-114.html")
    oz_html = source_path(args.oz_html, "oz", "oz-43936.html")

    alice = build_alice(alice_html, alice_art_html)
    oz = build_oz(oz_html)
    validate_story(alice, 12)
    validate_story(oz, 24)
    write_json(PUBLIC_ROOT / ALICE_SLUG / "story.json", alice)
    write_json(PUBLIC_ROOT / OZ_SLUG / "story.json", oz)
    print(
        json.dumps(
            {
                ALICE_SLUG: {
                    "chapters": len(alice["chapters"]),
                    "assets": len(alice["assets"]),
                    "blocks": sum(len(chapter["blocks"]) for chapter in alice["chapters"]),
                },
                OZ_SLUG: {
                    "chapters": len(oz["chapters"]),
                    "assets": len(oz["assets"]),
                    "blocks": sum(len(chapter["blocks"]) for chapter in oz["chapters"]),
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

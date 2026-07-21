"""Resolve automated public-domain source downloads to approved mirrors.

Canonical ``www.gutenberg.org`` URLs remain useful provenance links for human
readers, but builders must never request them.  This module maps the two source
tree layouts to independently hosted HTTPS mirrors from the official mirror
list.  There is intentionally no main-site fallback.
"""

from __future__ import annotations

import re
import urllib.parse


MAIN_HOSTS = {"gutenberg.org", "www.gutenberg.org"}
GENERATED_MIRRORS = (
    "https://gutenberg.pglaf.org/cache/epub",
    "https://mirror.cs.odu.edu/gutenberg-epub",
)
COLLECTION_MIRRORS = (
    "https://gutenberg.pglaf.org",
    "https://mirror.cs.odu.edu/gutenberg",
    "https://mirror.csclub.uwaterloo.ca/gutenberg",
)


def _collection_directory(ebook_id: str) -> str:
    prefix = "/".join(ebook_id[:-1])
    return f"{prefix}/{ebook_id}" if prefix else ebook_id


def source_download_candidates(url: str) -> tuple[str, ...]:
    """Return mirror-only candidates for a canonical source URL."""

    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if hostname not in MAIN_HOSTS:
        return (url,)

    generated = re.fullmatch(r"/cache/epub/(\d{1,8})/(.+)", parsed.path)
    if generated:
        ebook_id, relative = generated.groups()
        return tuple(f"{base}/{ebook_id}/{relative}" for base in GENERATED_MIRRORS)

    collection = re.fullmatch(r"/files/(\d{1,8})/(.+)", parsed.path)
    if collection:
        ebook_id, relative = collection.groups()
        directory = _collection_directory(ebook_id)
        return tuple(f"{base}/{directory}/{relative}" for base in COLLECTION_MIRRORS)

    raise RuntimeError(
        "Automated access to the human-facing source library is disabled; "
        f"no approved mirror mapping exists for {url}"
    )

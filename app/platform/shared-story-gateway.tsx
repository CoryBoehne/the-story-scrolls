"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StoryReaderLoader } from "./story-reader";
import { PlatformHeader } from "./site-shell";

export function SharedStoryGateway() {
  const [slug, setSlug] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const sharedIndex = segments.indexOf("shared");
    const pathCandidate = sharedIndex >= 0 ? segments[sharedIndex + 1] : undefined;
    const queryCandidate = new URLSearchParams(window.location.search).get("slug") ?? undefined;

    let candidate = pathCandidate ?? queryCandidate;
    try {
      candidate = candidate ? decodeURIComponent(candidate) : undefined;
    } catch {
      candidate = undefined;
    }

    const resolved =
      candidate && /^[a-z0-9][a-z0-9-]{0,99}$/i.test(candidate)
        ? candidate.toLocaleLowerCase()
        : null;
    const frame = window.requestAnimationFrame(() => setSlug(resolved));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (slug === undefined) {
    return (
      <main className="ss-story-state ss-story-state--loading">
        <span className="ss-story-state__rune" aria-hidden="true">S</span>
        <p className="ss-kicker">Finding your scroll</p>
        <h1>Following the story trail…</h1>
      </main>
    );
  }

  if (slug) {
    return (
      <StoryReaderLoader
        sourceUrl={`/api/v1/stories/${encodeURIComponent(slug)}`}
        fallbackSlug={slug}
        mode="community"
      />
    );
  }

  return (
    <main className="ss-platform ss-shared-landing">
      <PlatformHeader />
      <section>
        <span aria-hidden="true">S</span>
        <p className="ss-kicker">A scroll needs its address</p>
        <h1>No shared story was named.</h1>
        <p>Follow the complete link you received, or discover a public story on the community shelf.</p>
        <div>
          <Link className="ss-button ss-button--gold" href="/community/">Community library</Link>
          <Link className="ss-button ss-button--quiet" href="/">Curated library</Link>
        </div>
      </section>
    </main>
  );
}

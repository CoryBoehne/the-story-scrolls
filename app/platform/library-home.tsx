"use client";

import { useEffect, useState } from "react";
import { LibraryEntryExperience } from "./library-entry-experience";
import { type LibraryStory, unwrapLibraryPayload } from "./story-types";

const CURATED_FEATURED_SLUGS = new Set([
  "alice-in-wonderland",
  "the-wonderful-wizard-of-oz",
]);

export function LibraryHome() {
  const [community, setCommunity] = useState<LibraryStory[]>([]);
  const [communityState, setCommunityState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/v1/library", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const stories = unwrapLibraryPayload(payload)
          .filter(
            (story) =>
              !CURATED_FEATURED_SLUGS.has(story.slug)
              && story.visibility !== "private"
              && story.visibility !== "unlisted",
          )
          .slice(0, 3);
        setCommunity(stories);
        setCommunityState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCommunityState("unavailable");
      });

    return () => controller.abort();
  }, []);

  return <LibraryEntryExperience community={community} communityState={communityState} />;
}

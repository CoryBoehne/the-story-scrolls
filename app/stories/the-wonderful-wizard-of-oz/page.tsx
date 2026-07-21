import type { Metadata } from "next";
import { StoryReaderLoader } from "../../platform/story-reader";

export const metadata: Metadata = {
  title: "The Wonderful Wizard of Oz — The Story Scrolls",
  description:
    "L. Frank Baum’s public-domain fantasy in a continuous illustrated edition featuring W. W. Denslow’s original art.",
  alternates: { canonical: "/stories/the-wonderful-wizard-of-oz/" },
};

export default function OzStoryPage() {
  return (
    <StoryReaderLoader
      sourceUrl="/stories/the-wonderful-wizard-of-oz/story.json"
      aiSourceUrl="/stories/the-wonderful-wizard-of-oz/ai-illustrations.json"
      fallbackSlug="the-wonderful-wizard-of-oz"
      mode="curated"
    />
  );
}

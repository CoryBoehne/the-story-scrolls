import type { Metadata } from "next";
import { StoryReaderLoader } from "../../platform/story-reader";

export const metadata: Metadata = {
  title: "Alice’s Adventures in Wonderland — The Story Scrolls",
  description:
    "Lewis Carroll’s public-domain classic in a continuous illustrated edition featuring John Tenniel’s original art.",
  alternates: { canonical: "/stories/alice-in-wonderland/" },
};

export default function AliceStoryPage() {
  return (
    <StoryReaderLoader
      sourceUrl="/stories/alice-in-wonderland/story.json"
      aiSourceUrl="/stories/alice-in-wonderland/ai-illustrations.json"
      fallbackSlug="alice-in-wonderland"
      mode="curated"
    />
  );
}

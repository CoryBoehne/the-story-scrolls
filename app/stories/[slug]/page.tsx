import type { Metadata } from "next";
import { CURATED_LIBRARY, findCuratedBook } from "../../data/curated-library";
import { StoryReaderLoader } from "../../platform/story-reader";

type CuratedStoryPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return CURATED_LIBRARY.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: CuratedStoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const book = findCuratedBook(slug);

  return {
    title: book ? `${book.title} — The Story Scrolls` : "The Story Scrolls",
    description:
      book?.description ??
      "A continuous illustrated edition from The Story Scrolls curated library.",
    alternates: { canonical: `/stories/${slug}/` },
  };
}

export default async function CuratedStoryPage({ params }: CuratedStoryPageProps) {
  const { slug } = await params;

  return (
    <StoryReaderLoader
      sourceUrl={`/stories/${slug}/story.json`}
      aiSourceUrl={`/stories/${slug}/ai-illustrations.json`}
      fallbackSlug={slug}
      mode="curated"
    />
  );
}

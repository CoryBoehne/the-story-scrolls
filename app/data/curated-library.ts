import curatedBooksRegistry from "../../config/curated-books.json";

export type CuratedLibraryBook = {
  slug: string;
  title: string;
  author: string;
  illustrator: string;
  description: string;
  subtitle: string;
  expectedChapters: number;
  accent: string;
};

export const CURATED_LIBRARY = curatedBooksRegistry.map(
  ({
    slug,
    title,
    author,
    illustrator,
    description,
    subtitle,
    expectedChapters,
    accent,
  }): CuratedLibraryBook => ({
    slug,
    title,
    author,
    illustrator,
    description,
    subtitle,
    expectedChapters,
    accent,
  }),
);

export function findCuratedBook(slug: string) {
  return CURATED_LIBRARY.find((book) => book.slug === slug);
}

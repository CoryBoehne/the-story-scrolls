import type { Metadata } from "next";
import { CommunityLibrary } from "../platform/community-library";

export const metadata: Metadata = {
  title: "Community Library — The Story Scrolls",
  description: "Explore public stories shared by The Story Scrolls community.",
  alternates: { canonical: "/community/" },
};

export default function CommunityPage() {
  return <CommunityLibrary />;
}

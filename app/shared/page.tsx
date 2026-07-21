import type { Metadata } from "next";
import { SharedStoryGateway } from "../platform/shared-story-gateway";

export const metadata: Metadata = {
  title: "Shared Story — The Story Scrolls",
  description: "Open a story shared through The Story Scrolls.",
  robots: { index: false, follow: false },
};

export default function SharedLanding() {
  return <SharedStoryGateway />;
}

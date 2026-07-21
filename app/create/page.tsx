import type { Metadata } from "next";
import { CreateStudio } from "../platform/create-studio";

export const metadata: Metadata = {
  title: "Story Studio — The Story Scrolls",
  description:
    "Shape an original story or transform a source you may lawfully use into a beautifully illustrated reading experience.",
  alternates: { canonical: "/create/" },
};

export default function CreatePage() {
  return <CreateStudio />;
}

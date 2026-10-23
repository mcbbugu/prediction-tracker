import { permanentRedirect } from "next/navigation";

// The people list lives on the home page; this older page now points there.
export const metadata = { title: "人物" };

export default function SpeakersPage() {
  permanentRedirect("/");
}

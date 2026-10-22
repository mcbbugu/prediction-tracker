import { permanentRedirect } from "next/navigation";

// The people list lives on the home page; this older page now points there.
export default function SpeakersPage() {
  permanentRedirect("/");
}

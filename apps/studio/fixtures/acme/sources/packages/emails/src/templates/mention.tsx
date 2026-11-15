import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function MentionEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the mention email.</p>
      <Footer />
    </EmailLayout>
  );
}

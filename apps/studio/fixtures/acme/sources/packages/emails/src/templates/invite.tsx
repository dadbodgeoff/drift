import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function InviteEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the invite email.</p>
      <Footer />
    </EmailLayout>
  );
}

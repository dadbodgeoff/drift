import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function LoginCodeEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the login code email.</p>
      <Footer />
    </EmailLayout>
  );
}

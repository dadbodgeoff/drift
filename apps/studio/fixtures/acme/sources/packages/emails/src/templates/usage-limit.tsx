import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function UsageLimitEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the usage limit email.</p>
      <Footer />
    </EmailLayout>
  );
}

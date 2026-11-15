import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function TrialEndingEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the trial ending email.</p>
      <Footer />
    </EmailLayout>
  );
}

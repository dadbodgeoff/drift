import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function PayoutSentEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the payout sent email.</p>
      <Footer />
    </EmailLayout>
  );
}

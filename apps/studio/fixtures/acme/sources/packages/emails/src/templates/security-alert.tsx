import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function SecurityAlertEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the security alert email.</p>
      <Footer />
    </EmailLayout>
  );
}

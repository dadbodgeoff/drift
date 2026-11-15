import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function InvoiceEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the invoice email.</p>
      <Footer />
    </EmailLayout>
  );
}

import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function ExportReadyEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the export ready email.</p>
      <Footer />
    </EmailLayout>
  );
}

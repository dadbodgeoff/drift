import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function ReportSharedEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the report shared email.</p>
      <Footer />
    </EmailLayout>
  );
}

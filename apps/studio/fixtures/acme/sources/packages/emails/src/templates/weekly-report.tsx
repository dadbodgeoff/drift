import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function WeeklyReportEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the weekly report email.</p>
      <Footer />
    </EmailLayout>
  );
}

import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function MemberJoinedEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the member joined email.</p>
      <Footer />
    </EmailLayout>
  );
}

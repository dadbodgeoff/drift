import { EmailLayout } from "../components/layout";
import { Footer } from "../components/footer";

export default function CommentAddedEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the comment added email.</p>
      <Footer />
    </EmailLayout>
  );
}

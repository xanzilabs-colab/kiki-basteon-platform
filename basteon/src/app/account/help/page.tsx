import Link from "next/link";
import { ArrowLeft, CircleHelp, Mail } from "lucide-react";

const questions = [
  {
    question: "How do I update my profile or medical information?",
    answer: "Open Profile and choose Profile details or Medical ID. Keep the details you want your trusted network and responders to see up to date.",
  },
  {
    question: "Why does a Kiki feature ask for my location?",
    answer: "Map and other location-based features need your device or browser to allow location access. Check the permission for Kiki in your device or browser settings if location is unavailable.",
  },
  {
    question: "How do I contact Kiki support?",
    answer: "Email xanzitech@gmail.com. Your device’s default email app or web mail handler will open with our address filled in.",
  },
  {
    question: "Where can I see the Kiki plans?",
    answer: "Open Profile, then My plans & cover to compare the safety features listed for Kiki Essentials and Kiki Plus. Plan purchases and management are not currently available in the app.",
  },
  {
    question: "Where can I read the Terms and Privacy Policy?",
    answer: "The Terms of Service are available from Profile. Privacy controls are also in Profile; the Privacy Policy link will be added when its approved destination is provided.",
  },
];

export default function AccountHelpPage() {
  return (
    <div className="kiki-setting-page kiki-help-page">
      <header>
        <Link className="kiki-help-back" href="/account/profile"><ArrowLeft size={16} aria-hidden="true" />Profile</Link>
        <span>HELP &amp; SUPPORT</span>
        <h1>Frequently asked questions</h1>
        <p>Quick answers about your Kiki account and safety tools.</p>
      </header>
      <section aria-label="Frequently asked questions">
        {questions.map(({ question, answer }) => (
          <details className="kiki-help-question" key={question}>
            <summary><CircleHelp size={18} aria-hidden="true" /><span>{question}</span></summary>
            <p>{answer}</p>
          </details>
        ))}
        <a className="kiki-help-contact" href="mailto:xanzitech@gmail.com">
          <Mail size={17} aria-hidden="true" />Contact support
        </a>
      </section>
    </div>
  );
}

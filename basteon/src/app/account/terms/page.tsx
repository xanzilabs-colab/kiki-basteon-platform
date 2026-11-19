import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const terms = [
  {
    title: "Using Kiki",
    paragraphs: [
      "Kiki Connect provides personal safety tools and ways to connect with people you choose. Use the app lawfully and respectfully. Do not misuse its features, interfere with other people’s use, or knowingly submit false or harmful reports.",
      "Keep your sign-in details secure and make sure information you choose to add to your profile is accurate and up to date.",
    ],
  },
  {
    title: "Safety and emergencies",
    paragraphs: [
      "Kiki is a support tool, not a replacement for local emergency services. If you are in immediate danger, contact the appropriate emergency service directly when you can.",
      "Features may depend on your device, network connection, location settings, and permissions. Kiki cannot guarantee that an alert or message will be delivered, seen, or answered.",
    ],
  },
  {
    title: "Location and privacy",
    paragraphs: [
      "Some features need location permission to work. You can manage device permissions and the location controls available in your Kiki profile.",
      "Please review the Privacy Policy when it is published. For questions about these terms or your information, contact xanzitech@gmail.com.",
    ],
  },
  {
    title: "Availability and changes",
    paragraphs: [
      "We may update, change, or temporarily make parts of Kiki unavailable to maintain or improve the service. We may also update these terms; the latest version will be available on this page.",
    ],
  },
];

export default function TermsOfServicePage() {
  return (
    <div className="kiki-setting-page kiki-legal-page">
      <header>
        <Link className="kiki-help-back" href="/account/profile"><ArrowLeft size={16} aria-hidden="true" />Profile</Link>
        <span>HELP &amp; LEGAL</span>
        <h1>Terms of Service</h1>
        <p>Last updated 19 November 2026</p>
      </header>
      <section aria-label="Kiki Terms of Service">
        <p className="kiki-legal-intro">These terms describe the basic conditions for using Kiki Connect and its personal safety features.</p>
        {terms.map(({ title, paragraphs }) => (
          <article className="kiki-legal-section" key={title}>
            <h2>{title}</h2>
            {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </article>
        ))}
        <p className="kiki-legal-contact">Questions? <a href="mailto:xanzitech@gmail.com">Contact support</a>.</p>
      </section>
    </div>
  );
}

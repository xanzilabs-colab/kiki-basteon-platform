import Link from "next/link";
import { ArrowLeft, BadgeInfo } from "lucide-react";

const plans = ["Kiki Plan 1", "Kiki Plan 2"];

export default function AccountPlansPage() {
  return (
    <div className="kiki-setting-page kiki-plans-page">
      <header>
        <Link className="kiki-help-back" href="/account/profile"><ArrowLeft size={16} aria-hidden="true" />Profile</Link>
        <span>PLANS &amp; COVER</span>
        <h1>My plans &amp; cover</h1>
        <p>Explore the Kiki plan options.</p>
      </header>
      <aside className="kiki-plans-notice">
        <BadgeInfo size={18} aria-hidden="true" />
        <p>Plan names and details are placeholders for now. No plan, payment, or cover is activated from this page.</p>
      </aside>
      <section className="kiki-plan-list" aria-label="Kiki plan options">
        {plans.map((plan, index) => (
          <article className="kiki-plan-card" key={plan}>
            <span>OPTION {index + 1}</span>
            <h2>{plan}</h2>
            <p>Plan details will be added soon.</p>
            <b>Coming soon</b>
          </article>
        ))}
      </section>
    </div>
  );
}

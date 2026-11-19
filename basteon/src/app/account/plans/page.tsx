import Link from "next/link";
import { ArrowLeft, BadgeInfo, Check } from "lucide-react";

const plans = [
  {
    name: "Kiki Essentials",
    subtitle: "Everyday personal safety",
    badge: "Core safety",
    features: [
      "SOS alerts to your trusted network",
      "Guardian Circle and emergency contacts",
      "Medical ID in your profile",
      "Location-enabled safety tools",
    ],
  },
  {
    name: "Kiki Plus",
    subtitle: "More ways to stay connected",
    badge: "Expanded tools",
    features: [
      "Everything in Kiki Essentials",
      "Buddy walks and safer trip check-ins",
      "Bluetooth safety triggers",
      "Safe-spot map and community reports",
      "Calm and Stoep wellbeing tools",
    ],
  },
];

export default function AccountPlansPage() {
  return (
    <div className="kiki-setting-page kiki-plans-page">
      <header>
        <Link className="kiki-help-back" href="/account/profile"><ArrowLeft size={16} aria-hidden="true" />Profile</Link>
        <span>PLANS &amp; COVER</span>
        <h1>My plans &amp; cover</h1>
        <p>Compare the safety tools available with each Kiki plan.</p>
      </header>
      <aside className="kiki-plans-notice">
        <BadgeInfo size={18} aria-hidden="true" />
        <p>Prices, purchases, and plan management are not available in the app yet. Kiki features can depend on your device, permissions, and network connection.</p>
      </aside>
      <section className="kiki-plan-list" aria-label="Kiki plan options">
        {plans.map((plan) => (
          <article className="kiki-plan-card" key={plan.name}>
            <span>{plan.badge}</span>
            <h2>{plan.name}</h2>
            <p>{plan.subtitle}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}

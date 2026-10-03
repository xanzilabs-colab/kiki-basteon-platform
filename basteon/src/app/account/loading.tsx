import { KikiMark } from "@/components/KikiMark";

export default function Loading() {
  return (
    <main className="kiki-loader" aria-label="Loading Kiki Connect" role="status">
      <div className="kiki-loader-orbit">
        <KikiMark size={144} className="kiki-loader-mark" />
      </div>
      <span className="kiki-loader-wordmark">KIKI CONNECT</span>
      <span className="kiki-loader-caption">Preparing your safe space</span>
    </main>
  );
}
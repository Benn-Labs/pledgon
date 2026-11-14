import dynamic from "next/dynamic";

const LendingPageClient = dynamic(() => import("./LendingPageClient"), {
  ssr: false,
  loading: () => (
    <div className="fade-in max-w-4xl mx-auto py-16 text-center">
      <div className="inline-block w-8 h-8 border-2 border-ink-700 border-t-trust-500 rounded-full animate-spin" />
      <p className="text-sm text-ink-500 mt-3">Loading lending markets…</p>
    </div>
  ),
});

export default function LendingPage() {
  return <LendingPageClient />;
}

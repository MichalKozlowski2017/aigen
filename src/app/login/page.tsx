import { Suspense } from "react";
import { LoginForm } from "@/components/studio/login-form";

export default function StudioLoginPage() {
  return (
    <div className="mx-auto max-w-lg space-y-8 py-10">
      <header className="space-y-2 text-center">
        <h1
          className="text-3xl font-semibold text-stone-50"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          AIGen
        </h1>
        <p className="text-stone-400">Wprowadź hasło, aby otworzyć panel.</p>
      </header>
      <Suspense fallback={<p className="text-center text-sm text-stone-500">Ładowanie…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

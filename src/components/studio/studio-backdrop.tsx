/** Atmosferyczne tło panelu Studio — daylight / atrament, bez flat SaaS. */
export function StudioBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div
        className="absolute -left-1/4 top-[-10%] h-[55vh] w-[70vw] opacity-80 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--studio-glow-a), transparent 70%)",
        }}
      />
      <div
        className="absolute -right-1/5 bottom-[-5%] h-[50vh] w-[55vw] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--studio-glow-b), transparent 68%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(var(--studio-grid) 1px, transparent 1px),
            linear-gradient(90deg, var(--studio-grid) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 75%)",
        }}
      />
      <div className="studio-grain absolute inset-0 mix-blend-multiply" />
    </div>
  );
}

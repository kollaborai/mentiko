export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      data-auth-screen
      className="dark relative min-h-screen overflow-hidden bg-[#020302] text-foreground"
    >
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-0 auth-background-core" />
        <div className="absolute -left-[10vw] -top-[10vh] h-[66vh] w-[58vw] auth-halftone auth-halftone-teal" />
        <div className="absolute -bottom-[22vh] -right-[14vw] h-[58vh] w-[66vw] auth-halftone auth-halftone-ember" />
        <div className="absolute inset-0 auth-background-vignette" />
      </div>
      <div className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-8 sm:py-12">
        {children}
      </div>
    </main>
  );
}

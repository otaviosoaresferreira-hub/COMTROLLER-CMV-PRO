import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { ManagerModeProvider } from "@/lib/manager-mode";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ManagerModeToggle } from "@/components/manager-mode-toggle";

import { AuthProvider, useAuth } from "@/lib/auth";
import { BrandingProvider, useBranding, DEFAULT_LOGO_URL } from "@/lib/branding";
import appCss from "../styles.css?url";

const PUBLIC_ROUTES = ["/login", "/signup", "/reset-password"];

const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <Link to="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Ir para início
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "Controller CMV Pro — Controle de Estoque" },
      { name: "description", content: "Controle de estoque, custos e CMV otimizado para o dia a dia da operação." },
      { property: "og:title", content: "Controller CMV Pro — Controle de Estoque" },
      { name: "twitter:title", content: "Controller CMV Pro — Controle de Estoque" },
      { property: "og:description", content: "Controle de estoque, custos e CMV otimizado para o dia a dia da operação." },
      { name: "twitter:description", content: "Controle de estoque, custos e CMV otimizado para o dia a dia da operação." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6cd1ac48-269f-4037-a790-bc07a3afc7b2/id-preview-478d3ca5--adae2062-becd-4fef-8e9f-c229aa22eff1.lovable.app-1777277244266.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6cd1ac48-269f-4037-a790-bc07a3afc7b2/id-preview-478d3ca5--adae2062-becd-4fef-8e9f-c229aa22eff1.lovable.app-1777277244266.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function formatCnpjDisplay(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function CompanyHeaderBrand() {
  const { fantasyName, cnpj, logoDataUrl } = useBranding();
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Company logo floats organically — no border, no frame, no background */}
      {logoDataUrl ? (
        <img
          src={logoDataUrl}
          alt={fantasyName || "Logo da empresa"}
          className="h-[72px] w-auto max-w-[120px] shrink-0 object-contain"
        />
      ) : null}
      <div className="min-w-0 leading-tight">
        <p className="truncate text-base font-semibold md:text-lg">
          {fantasyName || "Sua Empresa"}
        </p>
        {cnpj ? (
          <p className="truncate text-[10px] text-muted-foreground">CNPJ: {formatCnpjDisplay(cnpj)}</p>
        ) : null}
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isPublic = PUBLIC_ROUTES.includes(location.pathname);

  useEffect(() => {
    if (!loading && !session && !isPublic) {
      navigate({ to: "/login" });
    }
  }, [loading, session, isPublic, navigate]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  }

  if (isPublic) return <>{children}</>;
  if (!session) return null;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 rounded-none flex-col">
          <header className="sticky top-0 z-30 flex h-24 items-center justify-between gap-2 border-b border-border bg-background/85 px-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger />
              <CompanyHeaderBrand />
            </div>
            <ManagerModeToggle />
          </header>
          <main className="min-w-0 flex-1 rounded-none">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrandingProvider>
          <ManagerModeProvider>
            <AuthGate>
              <Outlet />
            </AuthGate>
            <Toaster position="top-center" richColors />
            
          </ManagerModeProvider>
        </BrandingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

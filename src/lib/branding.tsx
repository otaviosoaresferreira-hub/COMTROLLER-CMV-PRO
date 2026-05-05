import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import defaultLogo from "@/assets/logo-controller-cmv-pro.png";

export const DEFAULT_LOGO_URL = defaultLogo;

export type BgTheme = "branco" | "preto" | "cinza-claro" | "cinza-escuro" | "azul-marinho" | "azul-oceano";
export type BtnTheme = "verde" | "azul" | "laranja" | "preto" | "branco" | "cinza";

export interface BrandingState {
  fantasyName: string;
  legalName: string;
  cnpj: string;
  logoDataUrl: string | null;
  bgTheme: BgTheme;
  btnTheme: BtnTheme;
}

export const DEFAULT_BRANDING: BrandingState = {
  fantasyName: "Controller CMV Pro",
  legalName: "",
  cnpj: "",
  logoDataUrl: null,
  bgTheme: "branco",
  btnTheme: "verde",
};
const DEFAULT = DEFAULT_BRANDING;

const STORAGE_KEY = "branding-settings-v1";

interface Ctx extends BrandingState {
  update: (patch: Partial<BrandingState>) => void;
  reset: () => void;
}

const BrandingContext = createContext<Ctx | undefined>(undefined);

// oklch values for backgrounds. [bg, fg, card, muted, border]
const BG_THEMES: Record<BgTheme, { label: string; bg: string; fg: string; card: string; muted: string; border: string; sidebar: string; isDark: boolean }> = {
  "branco":        { label: "Branco",        bg: "oklch(0.99 0 0)",       fg: "oklch(0.18 0.03 250)", card: "oklch(1 0 0)",       muted: "oklch(0.96 0.01 240)", border: "oklch(0.92 0.013 255)", sidebar: "oklch(0.98 0.003 248)", isDark: false },
  "preto":         { label: "Preto",         bg: "oklch(0.06 0 0)",       fg: "oklch(0.96 0 0)",      card: "oklch(0.16 0 0)",    muted: "oklch(0.20 0 0)",      border: "oklch(0.28 0 0)",       sidebar: "oklch(0.09 0 0)",       isDark: true  },
  "cinza-claro":   { label: "Cinza Claro",   bg: "oklch(0.94 0.003 250)", fg: "oklch(0.20 0.02 250)", card: "oklch(0.98 0 0)",    muted: "oklch(0.90 0.005 250)",border: "oklch(0.86 0.008 250)", sidebar: "oklch(0.92 0.004 250)", isDark: false },
  "cinza-escuro":  { label: "Cinza Escuro",  bg: "oklch(0.22 0.005 250)", fg: "oklch(0.96 0 0)",      card: "oklch(0.28 0.006 250)",muted: "oklch(0.30 0.005 250)",border: "oklch(0.36 0.008 250)",sidebar: "oklch(0.18 0.005 250)", isDark: true  },
  "azul-marinho":  { label: "Azul Marinho",  bg: "oklch(0.20 0.06 260)",  fg: "oklch(0.97 0.01 250)", card: "oklch(0.26 0.07 260)",muted: "oklch(0.28 0.06 260)", border: "oklch(0.34 0.07 260)",  sidebar: "oklch(0.16 0.06 260)",  isDark: true  },
  "azul-oceano":   { label: "Azul Oceano Profundo", bg: "oklch(0.22 0.05 230)", fg: "oklch(0.96 0.01 230)", card: "oklch(0.27 0.06 230)", muted: "oklch(0.30 0.05 230)", border: "oklch(0.36 0.06 230)", sidebar: "oklch(0.18 0.05 230)", isDark: true },
};

const BTN_THEMES: Record<BtnTheme, { label: string; primary: string; primaryFg: string }> = {
  "verde":   { label: "Verde",   primary: "oklch(0.60 0.16 155)", primaryFg: "oklch(0.99 0 0)" },
  "azul":    { label: "Azul",    primary: "oklch(0.55 0.18 255)", primaryFg: "oklch(0.99 0 0)" },
  "laranja": { label: "Laranja", primary: "oklch(0.70 0.18 50)",  primaryFg: "oklch(0.15 0.04 50)" },
  "preto":   { label: "Preto",   primary: "oklch(0.18 0 0)",      primaryFg: "oklch(0.99 0 0)" },
  "branco":  { label: "Branco",  primary: "oklch(0.99 0 0)",      primaryFg: "oklch(0.15 0 0)" },
  "cinza":   { label: "Cinza",   primary: "oklch(0.50 0.005 250)",primaryFg: "oklch(0.99 0 0)" },
};

export const BG_OPTIONS = (Object.keys(BG_THEMES) as BgTheme[]).map((k) => ({ key: k, label: BG_THEMES[k].label, swatch: BG_THEMES[k].bg }));
export const BTN_OPTIONS = (Object.keys(BTN_THEMES) as BtnTheme[]).map((k) => ({ key: k, label: BTN_THEMES[k].label, swatch: BTN_THEMES[k].primary }));

function applyTheme(bg: BgTheme, btn: BtnTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const b = BG_THEMES[bg];
  const p = BTN_THEMES[btn];
  // Apply variables — these override :root defaults
  root.style.setProperty("--background", b.bg);
  root.style.setProperty("--foreground", b.fg);
  root.style.setProperty("--card", b.card);
  root.style.setProperty("--card-foreground", b.fg);
  root.style.setProperty("--popover", b.card);
  root.style.setProperty("--popover-foreground", b.fg);
  root.style.setProperty("--muted", b.muted);
  root.style.setProperty("--secondary", b.muted);
  root.style.setProperty("--border", b.border);
  root.style.setProperty("--input", b.border);
  root.style.setProperty("--sidebar", b.sidebar);
  root.style.setProperty("--sidebar-foreground", b.fg);
  root.style.setProperty("--sidebar-border", b.border);
  root.style.setProperty("--sidebar-accent", b.muted);
  root.style.setProperty("--sidebar-accent-foreground", b.fg);
  root.style.setProperty("--primary", p.primary);
  root.style.setProperty("--primary-foreground", p.primaryFg);
  root.style.setProperty("--sidebar-primary", p.primary);
  root.style.setProperty("--sidebar-primary-foreground", p.primaryFg);
  root.style.setProperty("--ring", p.primary);
  // dark class hint for components that depend on it
  root.classList.toggle("dark", b.isDark);
}

function loadInitial(): BrandingState {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrandingState>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = loadInitial();
    setState(initial);
    applyTheme(initial.bgTheme, initial.btnTheme);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(state.bgTheme, state.btnTheme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota
    }
  }, [state, hydrated]);

  const update = (patch: Partial<BrandingState>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState(DEFAULT);

  return (
    <BrandingContext.Provider value={{ ...state, update, reset }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding deve ser usado dentro de BrandingProvider");
  return ctx;
}

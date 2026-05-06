import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import defaultLogo from "@/assets/logo-controller-cmv-pro.png";

export const DEFAULT_LOGO_URL = defaultLogo;

export type ThemeMode = "light" | "medium" | "dark";

export interface BrandingState {
  fantasyName: string;
  legalName: string;
  cnpj: string;
  logoDataUrl: string | null;
  themeMode: ThemeMode;
}

/** Cor oficial primária — laranja da marca. */
export const BRAND_PRIMARY = "#F96A0B";
export const BRAND_PRIMARY_HOVER = "#C4520A";

export const THEME_BACKGROUNDS: Record<ThemeMode, string> = {
  light: "#F5F5F5",
  medium: "#292E2B",
  dark: "#111111",
};

export const DEFAULT_BRANDING: BrandingState = {
  fantasyName: "Controller CMV Pro",
  legalName: "",
  cnpj: "",
  logoDataUrl: null,
  themeMode: "medium",
};

const STORAGE_KEY = "branding-settings-v3";
const LEGACY_KEYS = ["branding-settings-v2", "branding-settings-v1"];

interface Ctx extends BrandingState {
  update: (patch: Partial<BrandingState>) => void;
  reset: () => void;
}

const BrandingContext = createContext<Ctx | undefined>(undefined);

// ---------- Color utilities ----------
function clamp(n: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const a = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function isDark(hex: string): boolean {
  return luminance(hex) < 0.5;
}

function readableForeground(bgHex: string): string {
  return isDark(bgHex) ? "#ffffff" : "#0a0a0a";
}

function mix(aHex: string, bHex: string, t: number): string {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

function shift(hex: string, amount: number): string {
  const target = amount >= 0 ? "#ffffff" : "#000000";
  return mix(hex, target, Math.abs(amount));
}

function buildPalette(primary: string, background: string) {
  const dark = isDark(background);
  const fg = readableForeground(background);
  const primaryFg = readableForeground(primary);

  const card = dark ? shift(background, 0.08) : shift(background, 0.02);
  const popover = card;
  const muted = dark ? shift(background, 0.14) : shift(background, 0.05);
  const secondary = muted;
  const border = dark ? shift(background, 0.22) : shift(background, 0.12);
  const input = border;
  const sidebar = dark ? shift(background, 0.04) : shift(background, 0.015);
  const sidebarAccent = muted;

  const accent = dark ? mix(background, primary, 0.18) : mix(background, primary, 0.12);
  const accentFg = dark ? mix(primary, "#ffffff", 0.4) : mix(primary, "#000000", 0.45);
  const mutedFg = dark ? mix(fg, background, 0.18) : mix(fg, background, 0.22);

  return {
    background, foreground: fg, card, cardForeground: fg,
    popover, popoverForeground: fg,
    primary, primaryForeground: primaryFg,
    secondary, secondaryForeground: fg,
    muted, mutedForeground: mutedFg,
    accent, accentForeground: accentFg,
    border, input, ring: primary,
    sidebar, sidebarForeground: fg,
    sidebarPrimary: primary, sidebarPrimaryForeground: primaryFg,
    sidebarAccent, sidebarAccentForeground: fg,
    sidebarBorder: border, sidebarRing: primary,
    isDark: dark,
  };
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const background = THEME_BACKGROUNDS[mode];
  const p = buildPalette(BRAND_PRIMARY, background);
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  set("--background", p.background);
  set("--foreground", p.foreground);
  set("--card", p.card);
  set("--card-foreground", p.cardForeground);
  set("--popover", p.popover);
  set("--popover-foreground", p.popoverForeground);
  set("--primary", p.primary);
  set("--primary-foreground", p.primaryForeground);
  set("--primary-hover", BRAND_PRIMARY_HOVER);
  set("--secondary", p.secondary);
  set("--secondary-foreground", p.secondaryForeground);
  set("--muted", p.muted);
  set("--muted-foreground", p.mutedForeground);
  set("--accent", p.accent);
  set("--accent-foreground", p.accentForeground);
  set("--border", p.border);
  set("--input", p.input);
  set("--ring", p.ring);
  set("--sidebar", p.sidebar);
  set("--sidebar-foreground", p.sidebarForeground);
  set("--sidebar-primary", p.sidebarPrimary);
  set("--sidebar-primary-foreground", p.sidebarPrimaryForeground);
  set("--sidebar-accent", p.sidebarAccent);
  set("--sidebar-accent-foreground", p.sidebarAccentForeground);
  set("--sidebar-border", p.sidebarBorder);
  set("--sidebar-ring", p.sidebarRing);

  root.classList.toggle("dark", p.isDark);
  root.dataset.themeMode = mode;
}

function loadInitial(): BrandingState {
  if (typeof window === "undefined") return DEFAULT_BRANDING;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) };
    for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k);
      if (legacy) {
        const v = JSON.parse(legacy);
        return {
          ...DEFAULT_BRANDING,
          fantasyName: v.fantasyName ?? DEFAULT_BRANDING.fantasyName,
          legalName: v.legalName ?? "",
          cnpj: v.cnpj ?? "",
          logoDataUrl: v.logoDataUrl ?? null,
        };
      }
    }
    return DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrandingState>(DEFAULT_BRANDING);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = loadInitial();
    setState(initial);
    applyTheme(initial.themeMode);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(state.themeMode);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota
    }
  }, [state, hydrated]);

  const update = (patch: Partial<BrandingState>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState(DEFAULT_BRANDING);

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

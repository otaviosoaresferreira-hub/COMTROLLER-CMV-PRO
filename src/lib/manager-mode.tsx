import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const PASSWORD = "1234";
const STORAGE_KEY = "cmv_manager_mode";

type Ctx = {
  isManager: boolean;
  enable: (password: string) => boolean;
  disable: () => void;
};

const ManagerModeContext = createContext<Ctx | null>(null);

export function ManagerModeProvider({ children }: { children: ReactNode }) {
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "1") {
      setIsManager(true);
    }
  }, []);

  const enable = (password: string) => {
    if (password === PASSWORD) {
      setIsManager(true);
      sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    return false;
  };

  const disable = () => {
    setIsManager(false);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <ManagerModeContext.Provider value={{ isManager, enable, disable }}>
      {children}
    </ManagerModeContext.Provider>
  );
}

export function useManagerMode() {
  const ctx = useContext(ManagerModeContext);
  if (!ctx) throw new Error("useManagerMode must be used inside ManagerModeProvider");
  return ctx;
}

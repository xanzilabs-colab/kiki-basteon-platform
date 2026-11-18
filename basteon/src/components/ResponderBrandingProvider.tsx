"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type ResponderBrandingSeed = {
  id: string;
  name: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  branchName: string;
  operatorName: string;
};

const ResponderBrandingContext = createContext<ResponderBrandingSeed>({
  id: "",
  name: "",
  displayName: "",
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  branchName: "",
  operatorName: "",
});

export function ResponderBrandingProvider({
  value,
  children,
}: {
  value: ResponderBrandingSeed;
  children: ReactNode;
}) {
  return <ResponderBrandingContext.Provider value={value}>{children}</ResponderBrandingContext.Provider>;
}

export function useResponderBrandingSeed() {
  return useContext(ResponderBrandingContext);
}

import { useEffect } from "react";

import { applyResolved, useThemeStore } from "@/stores/theme";

function computeSystemResolved(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useSystemThemeListener() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    if (theme !== "system") return;

    const onChange = () => {
      const resolved = computeSystemResolved();
      useThemeStore.setState({ resolved });
      applyResolved(resolved);
    };

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
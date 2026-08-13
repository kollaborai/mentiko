"use client";

import ElectricMist from "@/components/ui/electric-mist";

const MIST_COLORS: Record<string, string> = {
  "#5b9ef5": "#3b6fe0", // workspace
  "#b07ee8": "#7c3aed", // workflows
  "#5cb88a": "#2f8f68", // marketplace
  "#f59e0b": "#b86b00", // docs and Mentiko
  "#a0927b": "#6f6250", // settings
};

interface PageBannerMistProps {
  sectionColor?: string;
  color?: string;
}

export function PageBannerMist({ sectionColor, color }: PageBannerMistProps) {
  const normalizedSectionColor = sectionColor?.toLowerCase();
  const mistColor =
    color ??
    (normalizedSectionColor ? MIST_COLORS[normalizedSectionColor] : undefined) ??
    sectionColor ??
    MIST_COLORS["#5b9ef5"];

  return (
    <ElectricMist
      className="bg-transparent overflow-visible mix-blend-screen"
      color={mistColor}
      speed={0.7}
      detail={1.5}
      distortion={2.4}
      brightness={1.15}
    />
  );
}

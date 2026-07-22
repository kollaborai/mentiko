"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface GifTextProps {
  /**
   * The text to display
   */
  text?: string;
  /**
   * The source URL for the background image/gif
   */
  gif?: string;
  /**
   * Class for the text element
   */
  className?: string;
  /**
   * Class for the container (e.g. height, background)
   */
  containerClassName?: string;
  /**
   * Applied when the gif cannot be loaded (offline / blocked host).
   * Keeps the text readable instead of stranding it on the loading state.
   */
  fallbackClassName?: string;
}

type GifStatus = "loading" | "ready" | "failed";

const GifText = ({
  text = "CHAMAAC",
  gif = "https://assets.amarn.me/gif-text.gif",
  className,
  containerClassName,
  fallbackClassName = "bg-gradient-to-br from-foreground to-foreground/50 bg-clip-text text-transparent",
}: GifTextProps) => {
  const [status, setStatus] = useState<GifStatus>(gif ? "loading" : "failed");

  useEffect(() => {
    if (!gif) return;

    const img = new Image();
    img.src = gif;
    img.onload = () => setStatus("ready");
    // upstream only wired onload, so a blocked/offline gif left the text stuck
    // on the grey pulse forever. degrade to a solid gradient fill instead.
    img.onerror = () => setStatus("failed");

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [gif]);

  const loading = status === "loading" && !!gif;
  const failed = status === "failed" || !gif;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-4 bg-white dark:bg-black",
        containerClassName
      )}
    >
      <h2
        className={cn(
          "text-[clamp(80px,12vw,150px)] font-extrabold select-none text-center leading-tight uppercase transition-colors duration-300 ",
          loading && "text-neutral-400 animate-pulse duration-100",
          !loading && failed && fallbackClassName,
          !loading && !failed && "text-transparent bg-clip-text bg-cover bg-center bg-no-repeat",
          className
        )}
        style={{
          backgroundImage: loading || failed ? undefined : `url(${gif})`,
          WebkitBackgroundClip: loading || failed ? undefined : "text",
          backgroundClip: loading || failed ? undefined : "text",
        }}
      >
        {text}
      </h2>
    </div>
  );
};

export default GifText;

import { useEffect, useState } from "react";

/** Match the SVG coordinate system to its container so labels stay legible. */
export function useChartSize() {
  const [element, containerRef] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(920);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return {
    containerRef,
    width,
    height: width < 520 ? 260 : 360,
    compact: width < 520,
  };
}

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { presentationAssetUrl } from "../services/session-scope.js";

type PreviewImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "loading"
> & { src: string };

// Only presentation URLs change. Stored sources, full-size viewers and exports
// continue to use the original asset.
export function PreviewImage({ src, style, ...props }: PreviewImageProps) {
  const source = presentationAssetUrl(
    /^\/api\/assets\/[a-f0-9]{64}$/.test(src) ? `${src}/thumbnail` : src,
  );
  const image = useRef<HTMLImageElement>(null);
  const [requested, setRequested] = useState<string>();
  useEffect(() => {
    const element = image.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setRequested(source);
      return;
    }
    // Native lazy loading may preload several screens on a slow connection.
    // Limit downloads to the visible area and a small scrolling margin.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRequested(source);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [source]);
  const active = requested === source;
  return (
    <img
      {...props}
      ref={image}
      src={active ? source : undefined}
      decoding="async"
      style={{ ...style, ...(!active ? { visibility: "hidden" } : {}) }}
    />
  );
}

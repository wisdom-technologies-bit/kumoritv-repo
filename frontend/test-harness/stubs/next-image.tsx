// Test double for next/image: renders a plain <img> with the same src.
import React from "react";

type ImageProps = {
  src?: unknown;
  alt?: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  [key: string]: unknown;
};

export default function Image({ src, alt, fill, sizes, priority, ...rest }: ImageProps) {
  const value =
    typeof src === "object" && src !== null && "src" in (src as object)
      ? (src as { src: string }).src
      : src;
  return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} src={value as string} alt={alt ?? ""} />;
}

import type { CSSProperties, ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number;
};

export default function Image({ src, fill, priority, quality: _quality, style, ...props }: Props) {
  const mergedStyle: CSSProperties = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : (style ?? {});
  return <img src={typeof src === "string" ? src : src.src} loading={priority ? "eager" : props.loading} style={mergedStyle} {...props} />;
}

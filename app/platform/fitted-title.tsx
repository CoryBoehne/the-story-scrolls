"use client";

import {
  Fragment,
  useEffect,
  useRef,
  type CSSProperties,
} from "react";

type HeadingTag = "h1" | "h2" | "h3";

type FittedTitleProps = {
  as: HeadingTag;
  children: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
  tabIndex?: number;
};

function titleWords(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean);
}

export function FittedTitle({
  as: Tag,
  children,
  className,
  id,
  style,
  tabIndex,
}: FittedTitleProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const words = titleWords(children);

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let lastWidth = -1;
    const tokens = titleWords(children);

    const fit = () => {
      animationFrame = 0;
      const initialStyle = window.getComputedStyle(title);
      const horizontalPadding = (Number.parseFloat(initialStyle.paddingLeft) || 0)
        + (Number.parseFloat(initialStyle.paddingRight) || 0);
      const availableWidth = title.clientWidth - horizontalPadding;
      if (availableWidth <= 0) return;
      lastWidth = title.clientWidth;

      title.style.removeProperty("font-size");
      title.classList.remove("is-extreme");
      const computed = window.getComputedStyle(title);
      const baseSize = Number.parseFloat(computed.fontSize);
      const minimumSize = Number.parseFloat(computed.getPropertyValue("--ss-title-fit-min")) || 16;
      const letterSpacing = Number.parseFloat(computed.letterSpacing) || 0;
      context.font = [
        computed.fontStyle,
        computed.fontVariant,
        computed.fontWeight,
        computed.fontSize,
        computed.fontFamily,
      ].join(" ");

      const widestToken = tokens.reduce((widest, token) => {
        const tokenWidth = context.measureText(token).width
          + Math.max(0, Array.from(token).length - 1) * letterSpacing;
        return Math.max(widest, tokenWidth);
      }, 0);
      if (widestToken <= availableWidth) return;

      const fittedSize = baseSize * ((availableWidth - 1) / widestToken) * 0.985;
      const nextSize = Math.max(minimumSize, fittedSize);
      title.style.fontSize = `${nextSize.toFixed(2)}px`;
      title.classList.toggle("is-extreme", fittedSize < minimumSize);
    };

    const scheduleFit = (force = false) => {
      const width = title.clientWidth;
      if (!force && Math.abs(width - lastWidth) < 0.5) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fit);
    };

    const resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(title);

    const zoomSurface = title.closest(".ss-reading-zoom-surface, .reading-zoom-surface");
    const zoomObserver = zoomSurface
      ? new MutationObserver(() => scheduleFit(true))
      : null;
    zoomObserver?.observe(zoomSurface!, {
      attributes: true,
      attributeFilter: ["data-reading-layout", "data-reading-zoom", "style"],
    });

    const handleResize = () => scheduleFit(true);
    window.addEventListener("resize", handleResize, { passive: true });
    void document.fonts?.ready.then(() => scheduleFit(true));
    scheduleFit(true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      zoomObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [children]);

  return (
    <Tag
      ref={titleRef}
      className={["ss-fitted-title", className].filter(Boolean).join(" ")}
      id={id}
      style={style}
      tabIndex={tabIndex}
    >
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="ss-fitted-title__token">{word}</span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}

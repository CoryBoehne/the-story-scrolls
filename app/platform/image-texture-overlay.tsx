"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type TextureState = "waiting" | "masked" | "disabled";
type TextureResult = {
  source: string;
  state: TextureState;
  maskUrl: string | null;
};

async function opaquePixelMask(image: HTMLImageElement) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error("The texture source did not decode.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A pixel mask could not be created.");

  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 3; index < pixels.data.length; index += 4) {
    const opaque = pixels.data[index] === 255;
    pixels.data[index - 3] = 0;
    pixels.data[index - 2] = 0;
    pixels.data[index - 1] = 0;
    pixels.data[index] = opaque ? 255 : 0;
  }

  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("The pixel mask was empty.")),
      "image/png",
    );
  });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The pixel mask could not be encoded."));
    }, { once: true });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The pixel mask could not be encoded."));
    }, { once: true });
    reader.readAsDataURL(blob);
  });
}

function alphaMaskSupported() {
  const style = document.documentElement.style;
  return "maskImage" in style || "webkitMaskImage" in style;
}

export function ImageTextureOverlay({
  source,
  fit = "contain",
}: {
  source: string;
  fit?: "contain" | "cover";
}) {
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [texture, setTexture] = useState<TextureResult>({
    source,
    state: "waiting",
    maskUrl: null,
  });

  useEffect(() => {
    const overlay = overlayRef.current;
    const image = overlay?.parentElement?.querySelector<HTMLImageElement>(":scope > img");
    let cancelled = false;
    let started = false;

    if (!image) return;

    const prepare = async () => {
      if (started || !image.naturalWidth) return;
      started = true;

      try {
        const nextMaskUrl = await opaquePixelMask(image);
        if (cancelled) return;
        if (!alphaMaskSupported()) {
          setTexture({ source, state: "disabled", maskUrl: null });
          return;
        }
        setTexture({ source, state: "masked", maskUrl: nextMaskUrl });
      } catch {
        // If pixels cannot be read, omit the treatment instead of painting it
        // across transparency that we cannot verify.
        if (!cancelled) setTexture({ source, state: "disabled", maskUrl: null });
      }
    };
    const disable = () => {
      started = true;
      if (!cancelled) setTexture({ source, state: "disabled", maskUrl: null });
    };

    image.addEventListener("load", prepare);
    image.addEventListener("error", disable);
    if (image.complete) queueMicrotask(() => void prepare());

    return () => {
      cancelled = true;
      image.removeEventListener("load", prepare);
      image.removeEventListener("error", disable);
    };
  }, [source]);

  const current = texture.source === source
    ? texture
    : { source, state: "waiting" as const, maskUrl: null };
  const style = current.maskUrl
    ? ({
        "--ss-image-opaque-mask": `url("${current.maskUrl}")`,
        "--ss-image-mask-fit": fit,
      } as CSSProperties)
    : undefined;
  const ready = current.state === "masked";

  return (
    <span
      ref={overlayRef}
      className={`ss-image-texture${ready ? " is-ready" : ""}${current.state === "masked" ? " is-alpha-masked" : ""}`}
      data-alpha-mask={current.state}
      style={style}
      aria-hidden="true"
    />
  );
}

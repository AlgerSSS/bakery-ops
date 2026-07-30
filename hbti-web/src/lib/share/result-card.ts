"use client";

import type {
  HbtiCode,
  HbtiResultContent,
  Locale,
} from "@/content/types";
import type { ColorChoice } from "@/content/ui";

interface ResultCardInput {
  code: HbtiCode;
  result: HbtiResultContent;
  color: ColorChoice;
  locale: Locale;
  signatureLabel: string;
  publicUrl: string;
}

interface CardPalette {
  background: string;
  panel: string;
  accent: string;
  ink: string;
  quietInk: string;
}

const CARD_PALETTES: Record<ColorChoice, CardPalette> = {
  cherry: {
    background: "#f8dfdc",
    panel: "#fff8f2",
    accent: "#b95f58",
    ink: "#59231b",
    quietInk: "#84534d",
  },
  blush: {
    background: "#fae9e6",
    panel: "#fffaf5",
    accent: "#efcbc6",
    ink: "#59231b",
    quietInk: "#84534d",
  },
  apricot: {
    background: "#f7e2cf",
    panel: "#fff9f1",
    accent: "#d99364",
    ink: "#59231b",
    quietInk: "#84534d",
  },
  sunshine: {
    background: "#f4e9c9",
    panel: "#fffaf0",
    accent: "#d7b65a",
    ink: "#59231b",
    quietInk: "#84534d",
  },
  pistachio: {
    background: "#e3e9cf",
    panel: "#fbf8ed",
    accent: "#b4c876",
    ink: "#59231b",
    quietInk: "#6f5a3f",
  },
  sky: {
    background: "#dfe9eb",
    panel: "#fbfaf5",
    accent: "#8fb6bd",
    ink: "#433331",
    quietInk: "#68777a",
  },
  lavender: {
    background: "#e9e1ed",
    panel: "#fdf9fb",
    accent: "#aa91b2",
    ink: "#4f304b",
    quietInk: "#756070",
  },
  cocoa: {
    background: "#84534d",
    panel: "#f9f2e3",
    accent: "#efcbc6",
    ink: "#f9f2e3",
    quietInk: "#f4ddd5",
  },
  cream: {
    background: "#efe2ce",
    panel: "#fffaf2",
    accent: "#d8c6aa",
    ink: "#59231b",
    quietInk: "#84534d",
  },
};

export function createResultShareText({
  code,
  result,
  signatureLabel,
}: Pick<ResultCardInput, "code" | "result" | "signatureLabel">): string {
  return [
    `HBTI ${code} · ${result.name}`,
    result.description,
    `${signatureLabel}: ${result.signatureOrder}`,
  ].join("\n");
}

export async function createResultCardPng({
  code,
  result,
  color,
  locale,
  signatureLabel,
  publicUrl,
}: ResultCardInput): Promise<Blob> {
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Result card canvas is unavailable.");
  }

  const palette = CARD_PALETTES[color];
  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, palette.background);
  gradient.addColorStop(1, palette.panel);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = palette.accent;
  context.beginPath();
  context.arc(930, 120, 180, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.ink;
  context.font = '700 32px "Neutra Text", "Avenir Next", sans-serif';
  context.letterSpacing = "5px";
  context.fillText("HOT CRUSH · HBTI", 72, 98);
  context.letterSpacing = "0px";

  context.font = '600 172px "Neutra Text", "Avenir Next", sans-serif';
  context.fillText(code, 72, 320);

  context.font = fontForLocale(locale, 62, 600);
  context.fillText(result.name, 72, 410);

  context.font = fontForLocale(locale, 28, 600);
  context.fillStyle = palette.quietInk;
  context.fillText(result.traits.join("  ·  "), 72, 468);

  context.strokeStyle = palette.accent;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(72, 520);
  context.lineTo(1008, 520);
  context.stroke();

  context.fillStyle = palette.ink;
  context.font = fontForLocale(locale, 38, 400);
  const descriptionBottom = drawWrappedText(
    context,
    result.description,
    72,
    600,
    920,
    56,
  );

  const orderTop = Math.max(descriptionBottom + 60, 940);
  context.fillStyle = palette.panel;
  context.beginPath();
  context.roundRect(72, orderTop, 936, 190, 38);
  context.fill();

  context.fillStyle = palette.quietInk;
  context.font = fontForLocale(locale, 22, 700);
  context.fillText(signatureLabel.toUpperCase(), 112, orderTop + 58);
  context.fillStyle = palette.ink;
  context.font = fontForLocale(locale, 34, 600);
  drawWrappedText(
    context,
    result.signatureOrder,
    112,
    orderTop + 112,
    856,
    44,
  );

  context.fillStyle = palette.quietInk;
  context.font = '500 23px "Neutra Text", "Avenir Next", sans-serif';
  context.fillText(cleanPublicUrl(publicUrl), 72, 1276);

  return canvasToPng(canvas);
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const usesSpaces = /\s/.test(text);
  const units = usesSpaces ? text.trim().split(/\s+/) : Array.from(text);
  const separator = usesSpaces ? " " : "";
  const lines: string[] = [];
  let line = "";

  for (const unit of units) {
    const candidate = line ? `${line}${separator}${unit}` : unit;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = unit;
  }
  if (line) {
    lines.push(line);
  }

  lines.slice(0, 5).forEach((value, index) => {
    context.fillText(value, x, startY + index * lineHeight);
  });
  return startY + Math.min(lines.length, 5) * lineHeight;
}

function fontForLocale(
  locale: Locale,
  size: number,
  weight: number,
): string {
  const family =
    locale === "zh-CN"
      ? '"OPPO Sans", "PingFang SC", sans-serif'
      : '"Neutra Text", "Avenir Next", sans-serif';
  return `${weight} ${size}px ${family}`;
}

function cleanPublicUrl(value: string): string {
  const url = new URL(value);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Unable to create result card."));
      }
    }, "image/png");
  });
}

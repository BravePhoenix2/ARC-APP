// Rectangle coordinates traced from the supplied ARTIC wordmark. Keep the
// gaps between blocks intact: they are part of the letterforms.
export const BRAND_LOGO_WIDTH = 765;
export const BRAND_LOGO_HEIGHT = 204;

export const BRAND_LOGO_PIECES = [
  // A
  { x: 0, y: 0, width: 128, height: 33, ink: "indigo", fill: "#3c2d78" },
  { x: 0, y: 40, width: 33, height: 43, ink: "indigo", fill: "#3c2d78" },
  { x: 94, y: 40, width: 34, height: 43, ink: "indigo", fill: "#3c2d78" },
  { x: 0, y: 91, width: 128, height: 34, ink: "indigo", fill: "#3c2d78" },
  { x: 0, y: 135, width: 33, height: 69, ink: "indigo", fill: "#3c2d78" },
  { x: 94, y: 135, width: 34, height: 69, ink: "indigo", fill: "#3c2d78" },
  // R
  { x: 163, y: 0, width: 62, height: 204, ink: "pink", fill: "#f13f70" },
  { x: 237, y: 0, width: 83, height: 33, ink: "pink", fill: "#f13f70" },
  { x: 286, y: 46, width: 34, height: 33, ink: "rose", fill: "#ee83b7" },
  { x: 237, y: 91, width: 83, height: 34, ink: "pink", fill: "#f13f70" },
  { x: 250, y: 135, width: 34, height: 34, ink: "rose", fill: "#ee83b7" },
  { x: 286, y: 171, width: 34, height: 33, ink: "pink", fill: "#f13f70" },
  // T
  { x: 355, y: 0, width: 169, height: 33, ink: "indigo", fill: "#3c2d78" },
  { x: 424, y: 46, width: 34, height: 158, ink: "violet", fill: "#7069b0" },
  // I
  { x: 558, y: 0, width: 62, height: 204, ink: "pink", fill: "#f13f70" },
  // C
  { x: 655, y: 0, width: 49, height: 33, ink: "rose", fill: "#ee83b7" },
  { x: 716, y: 0, width: 49, height: 33, ink: "rose", fill: "#ee83b7" },
  { x: 655, y: 40, width: 34, height: 49, ink: "rose", fill: "#ee83b7" },
  { x: 655, y: 115, width: 34, height: 49, ink: "rose", fill: "#ee83b7" },
  { x: 655, y: 171, width: 49, height: 33, ink: "rose", fill: "#ee83b7" },
  { x: 716, y: 171, width: 49, height: 33, ink: "rose", fill: "#ee83b7" },
] as const;

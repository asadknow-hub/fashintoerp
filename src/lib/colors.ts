// Turns a color name typed by a person ("Navy Blue", "off white") into a
// color to show as a small dot. Unknown names get a neutral dot.
const KNOWN: [string, string][] = [
  ["off white", "#f3efe4"],
  ["offwhite", "#f3efe4"],
  ["cream", "#f5efdc"],
  ["ivory", "#f6f1e1"],
  ["white", "#ffffff"],
  ["charcoal", "#3b3f46"],
  ["black", "#111111"],
  ["navy", "#1f2a4d"],
  ["sky", "#8ec9f0"],
  ["royal", "#2748c7"],
  ["blue", "#2f6fdd"],
  ["teal", "#1f8a8a"],
  ["mint", "#a8e0c5"],
  ["olive", "#6b6f2c"],
  ["khaki", "#b8a97a"],
  ["green", "#2f9e5b"],
  ["maroon", "#6e1b2b"],
  ["burgundy", "#6b1d33"],
  ["wine", "#6b1d33"],
  ["red", "#d43d3d"],
  ["pink", "#f2a1bd"],
  ["peach", "#f6c3a6"],
  ["orange", "#ee8a3a"],
  ["mustard", "#d2a52a"],
  ["yellow", "#f2d13d"],
  ["gold", "#c9a44c"],
  ["beige", "#d9c7a7"],
  ["tan", "#c19a6b"],
  ["camel", "#b98b54"],
  ["brown", "#6f4a2f"],
  ["chocolate", "#4b2e1f"],
  ["lavender", "#b9a8e8"],
  ["lilac", "#c7b3e6"],
  ["purple", "#7b4fc4"],
  ["silver", "#c3c6cc"],
  ["grey", "#8c9099"],
  ["gray", "#8c9099"],
];

export function colorDot(name: string | null) {
  const wanted = (name ?? "").toLowerCase();
  return KNOWN.find(([word]) => wanted.includes(word))?.[1] ?? "#d6d4e6";
}

export const tinifyFormats = ["png", "jpeg", "webp", "avif", "jxl"] as const;
export type TinifyFormat = (typeof tinifyFormats)[number];

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Study Studio",
    short_name: "Study Studio",
    description: "複数形式に対応した試験対策アプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#3167e3",
    icons: [
      {
        src: "/study-studio-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/study-studio-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

import { defineConfig } from "vitepress";
import markdown_it_mathjax3 from "markdown-it-mathjax3";

const links = [
  { text: "3D FDTD", link: "/3d_fdtd" },
  { text: "3D Electrostatic", link: "/3d_electrostatic" },
];

export default defineConfig({
  // site-level options
  title: "Impedance Lab Docs",
  description: "Documentation",
  lang: "en-US",
  markdown: {
    config: (md) => {
      md.use(markdown_it_mathjax3);
    },
  },
  themeConfig: {
    sidebar: [
      {
        items: links,
      },
    ],
    search: {
      provider: "local",
    },
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag): boolean => {
          return tag.startsWith("mjx-");
        },
      },
    },
  },
});

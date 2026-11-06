import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cloudflare Pages phục vụ ở thư mục gốc, nên base là "/".
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: { outDir: "dist" },
});

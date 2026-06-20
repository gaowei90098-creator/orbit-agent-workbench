import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@renderer": path.resolve(__dirname, "src/renderer") } },
  server: { port: 5175, strictPort: true, host: "127.0.0.1" },
});

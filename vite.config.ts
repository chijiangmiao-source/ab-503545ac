import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯静态前端：不配置任何代理或外部服务地址。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

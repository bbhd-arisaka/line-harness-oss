import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 純粋な TypeScript(src/lib)だけをテストする。React Native には依存しない。
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

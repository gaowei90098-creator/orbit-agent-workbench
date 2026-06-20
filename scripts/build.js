// AgentHub custom build script
// Bypasses electron-vite's esbuild config loading issue
const { build: viteBuild } = await import('vite');
const { execSync } = await import('child_process');
const path = await import('path');
const fs = await import('fs');
const root = process.cwd();

async function build() {
  console.log('=== AgentHub Build ===\n');

  // 1. Build renderer with Vite API (proven to work)
  console.log('[1/3] Building renderer...');
  await viteBuild({
    root: 'src/renderer', base: './',
    build: { outDir: '../../out/renderer', emptyOutDir: true },
    plugins: [
      (await import('@vitejs/plugin-react')).default(),
      (await import('@tailwindcss/vite')).default()
    ]
  });
  console.log('  Renderer OK\n');

  // 2. Compile preload with tsc
  console.log('[2/3] Compiling preload...');
  execSync('npx.cmd tsc src/preload/index.ts --outDir out/preload --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --allowSyntheticDefaultImports --declaration false', { stdio: 'inherit', cwd: root });
  console.log('  Preload OK\n');

  // 3. Compile main process with tsc
  console.log('[3/3] Compiling main process...');
  execSync('npx.cmd tsc src/main/index.ts --outDir out/main --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --allowSyntheticDefaultImports --declaration false', { stdio: 'inherit', cwd: root });
  console.log('  Main OK\n');

  console.log('=== Build complete! ===');
}

build().catch(e => { console.error('Build failed:', e); process.exit(1); });

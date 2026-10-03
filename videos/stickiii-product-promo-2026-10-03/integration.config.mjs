import path from 'node:path';
const repo = process.env.PRODUCT_REPO || path.resolve('product-snapshot');
export default {
  repoDir: repo,
  aliases: {'@product': path.join(repo,'src/renderer')},
  esbuild: {plugins: [{name:'film-desktop-bridge',setup(build) {
    build.onResolve({filter:/^\.\/desktop\.js$/},args => args.importer.endsWith('/App.tsx') ? {path:path.resolve('src/adapters/desktop.js')} : undefined);
  }}]},
};

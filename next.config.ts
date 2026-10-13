import type { NextConfig } from 'next';
const config:NextConfig = {
  serverExternalPackages:['pdfjs-dist'],
  outputFileTracingIncludes:{
    '/api/submissions/*/complete':['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
};
export default config;

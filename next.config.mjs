/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['@cedar-policy/cedar-wasm'],
  outputFileTracingIncludes: { '/api/v1/[...path]': ['./node_modules/@cedar-policy/cedar-wasm/nodejs/**'] },
};

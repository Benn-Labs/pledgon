import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { webpack }) => {
    // RainbowKit's Coinbase/Base Account connector pulls in @coinbase/cdp-sdk,
    // whose x402 payment-protocol modules import a whole family of @x402/*
    // packages we never use and that aren't installed. Ignore the entire
    // scope rather than aliasing each subpath individually.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};

export default nextConfig;

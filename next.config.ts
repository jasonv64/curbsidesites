import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Real client photos live in Azure Blob Storage (D3). Session 4's runbook
    // replaces <storage-account> with the provisioned account name. Local-dev
    // uploads are served same-origin via /uploads/* and need no entry here.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.blob.core.windows.net",
        pathname: "/tenant-images/**",
      },
    ],
  },
};

export default nextConfig;

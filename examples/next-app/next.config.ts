import { withRegresso } from "@regresso/next";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
};

// REGRESSO_DISABLE=1 builds the same app untagged; the spike script uses it as the baseline.
export default withRegresso(config, { enabled: process.env.REGRESSO_DISABLE !== "1" });

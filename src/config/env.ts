import { z } from "zod";
import { logger } from "../utils/logger";

// 环境变量验证 schema
const envSchema = z.object({
  // Server
  PORT: z.string().transform(Number).default("3010"),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Database
  DATABASE_PATH: z.string().default("./data/nodeseeker.db"),

  // RSS
  RSS_TIMEOUT: z.string().transform(Number).default("30000"),
  RSS_CHECK_ENABLED: z
    .string()
    .transform((val) => val !== "false")
    .default("true"),

  // CORS
  CORS_ORIGINS: z.string().default("http://localhost:3010"),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export async function loadEnvConfig(): Promise<EnvConfig> {
  // 强制重新加载配置
  cachedConfig = null;

  try {
    // 验证环境变量
    cachedConfig = envSchema.parse(process.env);

    logger.success("环境配置加载成功");
    return cachedConfig;
  } catch (error) {
    logger.error("环境配置验证失败:", error);
    throw new Error(`环境配置无效: ${error}`);
  }
}

export function getEnvConfig(): EnvConfig {
  if (!cachedConfig) {
    throw new Error("环境配置未加载，请先调用 loadEnvConfig()");
  }
  return cachedConfig;
}

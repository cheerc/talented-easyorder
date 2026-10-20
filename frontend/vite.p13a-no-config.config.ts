import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import baseConfig from './vite.config.ts';

const loadBaseConfig = baseConfig as (env: ConfigEnv) => UserConfig | Promise<UserConfig>;

export default defineConfig(async env => mergeConfig(await loadBaseConfig(env), {
  envDir: fileURLToPath(new URL('./e2e/fixtures/p13a-empty-env', import.meta.url)),
}));

import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';

// Validated environment, available to every module through the CONFIG token.
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
export class AppConfigModule {}

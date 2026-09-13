import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency.js';
import { DbService } from './db.service.js';

@Global()
@Module({
  providers: [DbService, IdempotencyService],
  exports: [DbService, IdempotencyService],
})
export class DbModule {}

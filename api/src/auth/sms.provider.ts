import { Injectable, Logger } from '@nestjs/common';

// The SMS gateway is a Phase 1 procurement item (proposal: "SMS provider
// contract and fallback provider"). Until then the console provider prints the
// message; swap the binding in AuthModule when the gateway is chosen.
export interface SmsProvider {
  send(phoneE164: string, message: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly log = new Logger('sms');
  async send(phoneE164: string, message: string) {
    this.log.log(`to ${phoneE164}: ${message}`);
  }
}

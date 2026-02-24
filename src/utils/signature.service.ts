import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class SignatureService {
  verify(rawBody: Buffer, signatureHeader?: string): void {
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing signature header');
    }

    const [scheme, receivedSig] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !receivedSig) {
      throw new UnauthorizedException('Invalid signature format');
    }

    const secret = process.env.WEBHOOK_SECRET!;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const receivedBuf = Buffer.from(receivedSig, 'hex');

    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new UnauthorizedException('Invalid signature');
    }
  }
}

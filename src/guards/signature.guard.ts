import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { SignatureService } from 'src/utils/signature.service';

@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(private readonly sigService: SignatureService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();
    const sig = req.header('x-signature');
    this.sigService.verify(req.rawBody ?? Buffer.from(''), sig || undefined);
    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { BookingsService } from '../bookings/bookings.service';

@Injectable()
export class CallsService {
  constructor(
    private readonly config: ConfigService,
    private readonly bookingsService: BookingsService,
  ) {}

  private buildAgoraToken(channelName: string, uid: number): { token: string; appId: string } {
    const appId = this.config.get<string>('AGORA_APP_ID')!;
    const appCertificate = this.config.get<string>('AGORA_APP_CERTIFICATE')!;
    const expirationSeconds = 3600;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationSeconds,
      expirationSeconds,
    );

    return { token, appId };
  }

  async generateTokenForCall(
    requesterUserId: string,
    otherUserId: string,
    channelName: string,
    uid: number,
  ): Promise<{ token: string; appId: string }> {
    await this.bookingsService.assertActiveBookingAccess(requesterUserId, otherUserId, 'CALL');
    return this.buildAgoraToken(channelName, uid);
  }

  billCall(
    _callerId: string,
    _professionalId: string,
    _callType: 'CALL' | 'VIDEO_CALL',
    durationSeconds: number,
  ): Promise<{ creditsCharged: number; minutesBilled: number; promotionalCreditsCharged: number; realCreditsCharged: number }> {
    const minutes = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
    return Promise.resolve({ creditsCharged: 0, minutesBilled: minutes, promotionalCreditsCharged: 0, realCreditsCharged: 0 });
  }
}

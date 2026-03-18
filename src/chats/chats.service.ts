import { Injectable } from '@nestjs/common';
const { RtcTokenBuilder, RtcRole } = require('agora-token');

@Injectable()
export class ChatsService {

  generateRtcToken(channelName: string, uid: number) {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    const role = RtcRole.PUBLISHER;

    const expirationTimeInSeconds = 3600; // 1 hora
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    return token;
  }
}
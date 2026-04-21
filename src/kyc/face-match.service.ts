import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FaceMatchResult = {
  score: number | null;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
};

@Injectable()
export class FaceMatchService {
  private readonly logger = new Logger(FaceMatchService.name);
  private rekognitionClient: any = null;

  constructor(private readonly configService: ConfigService) {
    this.initClient();
  }

  private initClient() {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'AWS credentials not set — face comparison will be SKIPPED. ' +
          'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION in .env to enable.',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RekognitionClient } = require('@aws-sdk/client-rekognition');
      this.rekognitionClient = new RekognitionClient({
        region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
        credentials: { accessKeyId, secretAccessKey },
      });
    } catch {
      this.logger.warn(
        '@aws-sdk/client-rekognition not installed — face comparison will be SKIPPED. ' +
          'Run: npm install @aws-sdk/client-rekognition',
      );
    }
  }

  async compareFaces(
    selfieBuffer: Buffer,
    idDocBuffer: Buffer,
  ): Promise<FaceMatchResult> {
    if (!this.rekognitionClient) {
      return { score: null, status: 'SKIPPED' };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CompareFacesCommand } = require('@aws-sdk/client-rekognition');

      const command = new CompareFacesCommand({
        SourceImage: { Bytes: selfieBuffer },
        TargetImage: { Bytes: idDocBuffer },
        SimilarityThreshold: 50,
      });

      const response = await this.rekognitionClient.send(command);
      const topMatch = response.FaceMatches?.[0];
      const score: number = topMatch?.Similarity ?? 0;
      const status = score >= 85 ? 'PASSED' : 'FAILED';

      this.logger.log(`Face match score: ${score.toFixed(1)}% → ${status}`);
      return { score, status };
    } catch (err) {
      this.logger.error('Face comparison error', err);
      return { score: null, status: 'SKIPPED' };
    }
  }
}

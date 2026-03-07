import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  // Obtener el ConfigService
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 4000;
  const frontendUrl = (
    configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
  ).replace(/\/$/, '');

  // Middleware de logging
  app.use((req, res, next) => {
    const { method, originalUrl } = req;
    const startTime = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const responseTime = Date.now() - startTime;
      logger.log(
        `${method} ${originalUrl} ${statusCode} - ${responseTime}ms`,
      );
    });

    next();
  });

  //  Configurar CORS desde variables de entorno
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Validación global mejorada
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('API REST')
    .setDescription('Documentación de mi API de Login')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Servidor corriendo papitos yijuu http://localhost:${port}`);
  logger.log(`🌐 Cors habilitado para este desgraciao: ${frontendUrl}`);
  logger.log(`📚 Documentación disponible en http://localhost:${port}/docs`);
  logger.log(`📱 Para tu celular usa: https://paginas-pachamama-backend.pk1ooa.easypanel.host:${port}`);
}
void bootstrap();

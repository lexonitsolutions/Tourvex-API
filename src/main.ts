import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  const frontendUrl = config.get<string>('FRONTEND_URL', 'http://localhost:3000');

  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: frontendUrl.split(',').map((url) => url.trim()), credentials: true });
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Karnish Tourism API')
    .setDescription('Travel booking, supplier, CRM inventory, billing, and partner API')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Clerk session token. In the browser obtain it with Clerk getToken() and send it as Authorization: Bearer <token>.',
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document, {
    jsonDocumentUrl: `${prefix}/openapi.json`,
  });

  await app.listen(config.get<number>('PORT', 4000), '0.0.0.0');
}

void bootstrap();

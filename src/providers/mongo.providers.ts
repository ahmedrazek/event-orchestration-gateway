import { ConfigService } from '@nestjs/config';
import * as mongoose from 'mongoose';

export const databaseProviders = [
  {
    provide: 'DATABASE_CONNECTION',
    useFactory: async (
      configService: ConfigService,
    ): Promise<typeof mongoose> => {
      const mongoUri = configService.get<string>('MONGO_URI');
      if (!mongoUri) {
        throw new Error('MONGO_URI is not set in .env');
      }
      return mongoose.connect(mongoUri);
    },
    inject: [ConfigService],
  },
];

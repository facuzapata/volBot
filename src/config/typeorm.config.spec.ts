import { typeOrmConfig } from './typeorm.config';

describe('typeOrmConfig', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV }; // Copia limpia
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USERNAME = 'testuser';
    process.env.DB_PASSWORD = 'testpass';
    process.env.DB_NAME = 'testdb';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('debería tener la configuración básica de TypeORM', () => {
    // Forzamos a recargar el módulo para que tome los nuevos valores de process.env
    jest.resetModules();
    const { typeOrmConfig } = require('./typeorm.config');
    expect(typeOrmConfig).toMatchObject({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'testuser',
      password: 'testpass',
      database: 'testdb',
      autoLoadEntities: true,
      synchronize: false,
    });
  });

  it('debería usar el puerto por defecto si DB_PORT no está definido', () => {
    process.env.DB_PORT = undefined;
    jest.resetModules();
    const { typeOrmConfig } = require('./typeorm.config');
    expect(typeOrmConfig.port).toBe(5432);
  });

  it('should accept DATABASE_* variables as a fallback', () => {
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USERNAME;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    process.env.DATABASE_HOST = 'db';
    process.env.DATABASE_PORT = '5433';
    process.env.DATABASE_USERNAME = 'database_user';
    process.env.DATABASE_PASSWORD = 'database_pass';
    process.env.DATABASE_NAME = 'database_name';

    jest.resetModules();
    const { typeOrmConfig } = require('./typeorm.config');

    expect(typeOrmConfig).toMatchObject({
      host: 'db',
      port: 5433,
      username: 'database_user',
      password: 'database_pass',
      database: 'database_name',
    });
  });
});

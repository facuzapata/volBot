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
      synchronize: true,
    });
  });

  it('debería usar el puerto por defecto si DB_PORT no está definido', () => {
    process.env.DB_PORT = undefined;
    jest.resetModules();
    const { typeOrmConfig } = require('./typeorm.config');
    expect(typeOrmConfig.port).toBe(5432);
  });
});
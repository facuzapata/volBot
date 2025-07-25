// Script temporal para limpiar órdenes fallidas
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { StrategyService } from './src/strategy/services/strategy.service';

async function cleanup() {
    console.log('🚀 Iniciando aplicación...');

    const app = await NestFactory.create(AppModule);
    const strategyService = app.get(StrategyService);

    console.log('🧹 Ejecutando limpieza de órdenes fallidas...');
    await strategyService.cleanupFailedOrders();

    console.log('🔄 Ejecutando sincronización de órdenes pendientes...');
    await strategyService.syncPendingOrders();

    console.log('✅ Proceso completado');
    await app.close();
}

cleanup().catch(console.error);

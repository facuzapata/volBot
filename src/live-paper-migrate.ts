import db from './v2/persistence/data-source';
import {ProspectivePaper1795200000000} from './v2/live-paper/migration';
async function migrate(){db.setOptions({migrations:[...(db.options.migrations as never[]),ProspectivePaper1795200000000]});await db.initialize();try{await db.runMigrations({transaction:'all'});}finally{await db.destroy();}}
void migrate().catch(e=>{console.error(e instanceof Error?e.message:'Migration failed');process.exitCode=1;});

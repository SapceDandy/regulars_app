import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {databaseConfiguration,openPostgresStore} from '../packages/db/postgres.js';

// Read-only deployment gate. Does not initialize venues, send messages or call payments.
export async function verifyDatabase(env,openHosted=openPostgresStore) {
  if(env.DATABASE_PROVIDER!=='supabase')return {skipped:true};
  const config=databaseConfiguration(env);
  const store=openHosted(config.connectionString,config);
  try {
    const state=await store.get(`SELECT current_schema() AS schema,
      (SELECT count(*) FROM pg_tables WHERE schemaname=current_schema()) AS tables,
      (SELECT bool_and(rowsecurity) FROM pg_tables WHERE schemaname=current_schema()) AS rls,
      (SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) FROM pg_roles WHERE rolname=current_user) AS restricted,
      has_schema_privilege('anon',current_schema(),'USAGE') AS anon_access,
      has_schema_privilege('authenticated',current_schema(),'USAGE') AS authenticated_access`);
    if(state.schema!=='regulars'||state.tables<29||!state.rls||!state.restricted||state.anon_access||state.authenticated_access)throw Error('Database isolation verification failed');
    return {verified:true,tables:state.tables};
  } finally {await store.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await verifyDatabase(process.env);
    console.log(result.skipped?'Supabase verification skipped: another database provider is selected.':`Supabase verified: TLS connection, restricted role, private schema and RLS on ${result.tables} tables.`);
  } catch(error) {
    const code=/^[A-Z0-9_]{2,50}$/.test(error.code)?error.code:'VERIFICATION_FAILED';
    console.error(`Supabase verification failed (${code}). Check private database configuration.`);
    process.exitCode=1;
  }
}

import { defineDrizzleKitConfig } from '@homurajs/db'

export default defineDrizzleKitConfig({
  dialect: 'sqlite',
  schemaGlob: './apps/server/src/schema.ts',
  out: './apps/server/drizzle/sqlite',
})

import 'dotenv/config';
import app from './app';
import { runMigrations } from './migrate';

const PORT = process.env.PORT ?? 3002;

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`task-service listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[migrate] Fatal — exiting:', err);
    process.exit(1);
  });

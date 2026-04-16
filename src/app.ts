import express from 'express';
import morgan from 'morgan';
import tasksRouter from './routes/tasks';

const app = express();

app.use(express.json());
app.use(morgan('combined'));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'task-service' });
});

app.use('/tasks', tasksRouter);

export default app;

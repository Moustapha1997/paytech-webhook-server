import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import webhookRoutes from './routes/webhook';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Route de test
app.get('/health', (_, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Routes Webhook
app.use('/webhook', webhookRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
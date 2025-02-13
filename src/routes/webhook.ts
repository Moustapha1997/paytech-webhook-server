import { Router, Request, Response } from 'express';
import { PayTechNotification } from '../types/paytech';
import { supabase } from '../config/supabase';
import { sha256 } from '../utils/crypto';

const router = Router();

async function handleWebhook(req: Request, res: Response) {
    console.log('Webhook reçu:', req.body);

    try {
        const notification = req.body as PayTechNotification;
        
        if (notification.type_event !== 'sale_complete') {
            res.status(200).json({ status: 'ignored' });
            return;
        }

        // Vérifier la signature
        const apiKeyHash = sha256(process.env.PAYTECH_API_KEY!);
        const apiSecretHash = sha256(process.env.PAYTECH_API_SECRET!);

        if (
            apiKeyHash !== notification.api_key_sha256 || 
            apiSecretHash !== notification.api_secret_sha256
        ) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        // Récupérer la réservation en attente
        const { data: pendingReservation, error: fetchError } = await supabase
            .from('reservations_pending')
            .select('*')
            .eq('ref_command', notification.ref_command)
            .single();

        if (fetchError || !pendingReservation) {
            res.status(404).json({ error: 'Reservation not found' });
            return;
        }

        // Créer la réservation confirmée
        const confirmedReservation = {
            ...pendingReservation.reservation_data,
            statut: 'validee',
            payment_status: 'completed',
            payment_ref: notification.ref_command,
            payment_details: notification
        };

        // Insérer dans reservations
        const { error: insertError } = await supabase
            .from('reservations')
            .insert([confirmedReservation]);

        if (insertError) {
            res.status(500).json({ error: 'Insert failed' });
            return;
        }

        // Supprimer de reservations_pending
        await supabase
            .from('reservations_pending')
            .delete()
            .eq('ref_command', notification.ref_command);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Erreur webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
}

router.post('/', handleWebhook);

export default router;